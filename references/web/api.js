// SPDX-License-Identifier: AGPL-3.0-only
// A fixed authorized module origin owns credentials; paths cannot retarget it.
export function createApi({
  base = new URL("./api/", location.href),
  accessToken,
} = {}) {
  const root = new URL(base, location.href);
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  function url(path = "") {
    if (
      typeof path !== "string" ||
      path.startsWith("/") ||
      path.includes("\\") ||
      /^[a-z][a-z0-9+.-]*:/i.test(path)
    )
      throw Error("Expected a relative References API path");
    const value = new URL(path, root);
    if (
      value.origin !== root.origin ||
      !value.pathname.startsWith(root.pathname)
    )
      throw Error("References path is outside its authorized API");
    return value;
  }
  async function request(
    path,
    { method = "GET", body, signal, headers = {} } = {},
  ) {
    const fields = new Headers(headers);
    if (accessToken) fields.set("Authorization", "Bearer " + accessToken);
    if (
      body !== undefined &&
      !(body instanceof Blob) &&
      !(body instanceof FormData)
    ) {
      fields.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await fetch(url(path), {
      method,
      body,
      signal,
      headers: fields,
      credentials: accessToken ? "omit" : "same-origin",
      redirect: "error",
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(Error(data.error || "References request failed"), {
        status: response.status,
        details: data,
      });
    return data;
  }
  return {
    request,
    url,
    project(id) {
      if (!id || id === "." || id === "..")
        throw Error("Select a project library");
      const prefix = "projects/" + encodeURIComponent(id) + "/";
      const projectRoot = url(prefix);
      const scopedPath = (path) => {
        const target = url(prefix + path);
        if (!target.pathname.startsWith(projectRoot.pathname))
          throw Error("References path is outside its selected library");
        return prefix + path;
      };
      return {
        request: (path, options) => request(scopedPath(path), options),
        url: (path) => url(scopedPath(path)),
      };
    },
  };
}
