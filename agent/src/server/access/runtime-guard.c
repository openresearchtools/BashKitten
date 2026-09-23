// SPDX-License-Identifier: GPL-3.0-only
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* A subreaper also owns orphaned descendants which called setsid(), such as Pi
 * workers. Signal only our direct children: this thread does not reap between
 * reading their identities and signalling them, so their PIDs cannot be reused.
 * As parents exit, the next pass receives their remaining children. */
struct identity {
    pid_t parent;
    unsigned long long started;
};

static sigset_t signals;
static pid_t controller;
static bool stopping, wake_owned, termux;
static double stop_deadline;

static double monotonic_seconds(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
        perror("runtime-guard: clock_gettime");
        abort();
    }
    return (double)now.tv_sec + (double)now.tv_nsec / 1e9;
}

static bool identify(pid_t pid, struct identity *identity) {
    char path[64], data[4096];
    snprintf(path, sizeof(path), "/proc/%ld/stat", (long)pid);
    FILE *file = fopen(path, "r");
    if (!file) return false;
    size_t count = fread(data, 1, sizeof(data) - 1, file);
    bool read_ok = count > 0 && !ferror(file);
    data[count] = '\0';
    fclose(file);
    if (!read_ok) return false;
    /* comm may contain spaces and ')' characters; state follows the last ')'. */
    char *field = strrchr(data, ')');
    if (!field || strlen(field) < 4) return false;
    field += 4;
    for (int number = 4; number <= 22; ++number) {
        char *end;
        errno = 0;
        unsigned long long value = strtoull(field, &end, 10);
        if (end == field || errno) return false;
        if (number == 4) identity->parent = (pid_t)value;
        if (number == 22) identity->started = value;
        field = end;
        while (*field == ' ') ++field;
    }
    return true;
}

static void signal_child(pid_t pid, int signal_number) {
    struct identity first, current;
    if (pid <= 1 || !identify(pid, &first) || first.parent != getpid()) return;
    if (!identify(pid, &current) || current.parent != first.parent ||
        current.started != first.started) return;
    if (kill(pid, signal_number) != 0 && errno != ESRCH)
        perror("runtime-guard: signal child");
}

static void signal_children(int signal_number) {
    DIR *directory = opendir("/proc");
    if (!directory) {
        perror("runtime-guard: enumerate children");
        return;
    }
    struct dirent *entry;
    while ((entry = readdir(directory))) {
        char *end;
        errno = 0;
        long number = strtol(entry->d_name, &end, 10);
        if (errno || end == entry->d_name || *end || number <= 1 || number > INT_MAX)
            continue;
        signal_child((pid_t)number, signal_number);
    }
    closedir(directory);
}

static void receive_signal(int signal_number) {
    if (signal_number == SIGUSR1) {
        if (termux) wake_owned = true;
    } else if (signal_number == SIGUSR2) {
        wake_owned = false;
    } else if (signal_number != SIGCHLD && !stopping) {
        stopping = true;
        stop_deadline = monotonic_seconds() + 30;
        signal_child(controller, SIGTERM);
    }
}

static void drain_signals(void) {
    const struct timespec immediate = {0, 0};
    int received;
    while ((received = sigtimedwait(&signals, NULL, &immediate)) > 0)
        receive_signal(received);
}

static void child_setup(pid_t expected_parent, int death_signal) {
    if (prctl(PR_SET_PDEATHSIG, death_signal) != 0 ||
        getppid() != expected_parent) _exit(125);
    sigset_t empty;
    sigemptyset(&empty);
    if (sigprocmask(SIG_SETMASK, &empty, NULL) != 0) _exit(125);
}

/* The desktop controller adopts its browser's lifetime without a lease or a
 * heartbeat. A pidfd cannot silently become a different process after PID reuse.
 * This helper remains a child of the existing controller/subreaper; it never
 * signals an arbitrary PID or survives the controller that requested it. */
static int wait_owner(const char *pid_text, const char *started_text) {
    pid_t parent = getppid();
    child_setup(parent, SIGKILL);
    char *end;
    errno = 0;
    long number = strtol(pid_text, &end, 10);
    if (errno || *end || number <= 1 || number > INT_MAX) return 64;
    pid_t pid = (pid_t)number;
    errno = 0;
    unsigned long long started = strtoull(started_text, &end, 10);
    if (errno || *end || !started) return 64;
    struct identity before, after;
    if (!identify(pid, &before) || before.started != started) return 125;
    int descriptor = (int)syscall(SYS_pidfd_open, pid, 0);
    if (descriptor < 0) {
        perror("runtime-guard: watch browser");
        return 125;
    }
    if (!identify(pid, &after) || after.started != started) {
        close(descriptor);
        return 125;
    }
    struct pollfd owner = {.fd = descriptor, .events = POLLIN};
    if (poll(&owner, 1, 0) != 0) {
        close(descriptor);
        return 125;
    }
    if (puts("ready") < 0 || fflush(stdout) != 0) {
        close(descriptor);
        return 125;
    }
    int result;
    do { result = poll(&owner, 1, -1); } while (result < 0 && errno == EINTR);
    close(descriptor);
    return result > 0 && (owner.revents & POLLIN) ? 0 : 125;
}

static bool release_wake_lock(void) {
    if (!wake_owned) return true;
    pid_t owner = getpid(), child = fork();
    if (child < 0) {
        perror("runtime-guard: fork wake unlock");
        return false;
    }
    if (!child) {
        child_setup(owner, SIGKILL);
        execlp("termux-wake-unlock", "termux-wake-unlock", (char *)NULL);
        perror("runtime-guard: termux-wake-unlock");
        _exit(127);
    }
    double deadline = monotonic_seconds() + 10;
    double descendants_deadline = 0;
    bool completed = false, success = false, timed_out = false;
    int status;
    for (;;) {
        pid_t result = waitpid(-1, &status, WNOHANG);
        if (result == child) {
            completed = true;
            success = WIFEXITED(status) && WEXITSTATUS(status) == 0;
            descendants_deadline = monotonic_seconds() + 2;
        } else if (result < 0) {
            if (errno == ECHILD) return success && !timed_out;
            if (errno != EINTR) return false;
        }
        double now = monotonic_seconds();
        if (now >= deadline) timed_out = true;
        if (timed_out || (completed && now >= descendants_deadline))
            signal_children(SIGKILL);
        else if (completed) signal_children(SIGTERM);
        const struct timespec pause = {0, 50000000};
        nanosleep(&pause, NULL);
    }
}

int main(int argc, char **argv) {
    if (argc == 4 && strcmp(argv[1], "wait-owner") == 0)
        return wait_owner(argv[2], argv[3]);
    if (argc < 4 || strcmp(argv[argc - 1], "serve") != 0) {
        fprintf(stderr, "Usage: runtime-guard <node> <control.mjs> serve\n");
        return 64;
    }
    struct identity self;
    if (!identify(getpid(), &self) || prctl(PR_SET_CHILD_SUBREAPER, 1) != 0) {
        fprintf(stderr, "runtime-guard: child ownership requires /proc and subreaper support\n");
        return 125;
    }
    termux = getenv("BASHKITTEN_TERMUX") &&
        strcmp(getenv("BASHKITTEN_TERMUX"), "1") == 0;
    sigemptyset(&signals);
    sigaddset(&signals, SIGCHLD);
    sigaddset(&signals, SIGTERM);
    sigaddset(&signals, SIGINT);
    sigaddset(&signals, SIGHUP);
    sigaddset(&signals, SIGUSR1);
    sigaddset(&signals, SIGUSR2);
    if (sigprocmask(SIG_BLOCK, &signals, NULL) != 0) {
        perror("runtime-guard: block signals");
        return 125;
    }
    /* SIGCHLD=SIG_IGN inherited from a launcher would reap children implicitly
     * and invalidate our no-PID-reuse guarantee. Restore normal dispositions. */
    const struct sigaction normal = {.sa_handler = SIG_DFL};
    const int defaults[] = {SIGCHLD, SIGTERM, SIGINT, SIGHUP, SIGUSR1, SIGUSR2};
    for (size_t i = 0; i < sizeof(defaults) / sizeof(defaults[0]); ++i) {
        if (sigaction(defaults[i], &normal, NULL) != 0) {
            perror("runtime-guard: signal disposition");
            return 125;
        }
    }
    pid_t owner = getpid();
    controller = fork();
    if (controller < 0) {
        perror("runtime-guard: fork controller");
        return 125;
    }
    if (!controller) {
        child_setup(owner, SIGTERM);
        if (setpgid(0, 0) != 0) _exit(125);
        char pid[32];
        snprintf(pid, sizeof(pid), "%ld", (long)owner);
        if (setenv("BASHKITTEN_GUARDED", "1", 1) != 0 ||
            setenv("BASHKITTEN_GUARD_PID", pid, 1) != 0) _exit(125);
        execvp(argv[1], &argv[1]);
        perror("runtime-guard: exec controller");
        _exit(127);
    }
    /* The child also calls setpgid so it is established before exec. */
    if (setpgid(controller, controller) != 0 && errno != EACCES && errno != ESRCH)
        perror("runtime-guard: controller process group");

    bool controller_dead = false, cleanup = false;
    int controller_status = 125;
    double kill_deadline = 0;
    for (;;) {
        drain_signals();
        bool no_children = false;
        int status;
        pid_t child;
        while ((child = waitpid(-1, &status, WNOHANG)) != 0) {
            if (child < 0) {
                if (errno == EINTR) continue;
                no_children = errno == ECHILD;
                break;
            }
            if (child == controller) {
                controller_dead = true;
                controller_status = WIFEXITED(status) ? WEXITSTATUS(status) :
                    WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 125;
            }
        }
        if (no_children) {
            /* Consume the controller's final wake ownership notification too. */
            drain_signals();
            break;
        }
        double now = monotonic_seconds();
        if (!cleanup && (controller_dead || (stopping && now >= stop_deadline))) {
            cleanup = true;
            kill_deadline = now + 2;
        }
        if (cleanup) signal_children(now >= kill_deadline ? SIGKILL : SIGTERM);

        struct timespec timeout = {0, 100000000};
        if (!cleanup) {
            timeout.tv_sec = stopping ? 1 : 60;
            timeout.tv_nsec = 0;
        }
        int received = sigtimedwait(&signals, NULL, &timeout);
        if (received > 0) receive_signal(received);
        else if (errno != EAGAIN && errno != EINTR)
            perror("runtime-guard: wait for child signal");
    }
    if (!release_wake_lock()) {
        fprintf(stderr, "runtime-guard: Termux wake unlock failed\n");
        if (!controller_status) controller_status = 1;
    }
    return controller_status;
}
