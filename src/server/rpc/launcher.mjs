#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { selectedRuntime, allowRuntimeWork } from './runtime.mjs';
import '../platform/index.mjs';
allowRuntimeWork();
const child = spawn(process.execPath, [selectedRuntime().cli, '--offline', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); } else process.exitCode = code; });
