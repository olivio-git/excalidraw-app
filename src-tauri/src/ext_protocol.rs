//! `qori-ext:` protocol: serves the files of installed VS Code extensions to
//! their webviews.
//!
//! Webviews are sandboxed `srcdoc` iframes, so their origin is `null`. Module
//! scripts, fonts and `fetch` are CORS requests, and Tauri's asset protocol
//! only allows the main window's origin; this one answers with
//! `Access-Control-Allow-Origin: *`. Only files inside the app's
//! `extensions` folder are served.
//!
//! URLs keep the path readable (`qori-ext://localhost/home/ana/.../index.js`,
//! or `http://qori-ext.localhost/C:/...` on Windows) so relative URLs inside
//! the extension's scripts and styles resolve like on disk.

use std::path::{Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub const SCHEME: &str = "qori-ext";

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = input.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// File path from the request path (`/home/ana/x.js`, `/C:/Users/x.js`).
pub fn path_from_uri_path(uri_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(uri_path)?;
    // Windows drive paths come as `/C:/...`.
    let bytes = decoded.as_bytes();
    let trimmed = if bytes.len() > 2 && bytes[0] == b'/' && bytes[2] == b':' {
        &decoded[1..]
    } else {
        decoded.as_str()
    };
    Some(PathBuf::from(trimmed))
}

pub fn mime_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Resolves the request to a file inside `root`, or the status to answer.
pub fn resolve(root: &Path, uri_path: &str) -> Result<PathBuf, StatusCode> {
    let requested = path_from_uri_path(uri_path).ok_or(StatusCode::BAD_REQUEST)?;
    let root = root.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    let file = requested
        .canonicalize()
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !file.starts_with(&root) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !file.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(file)
}

fn respond(root: &Path, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let builder = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache");
    if request.method() == tauri::http::Method::OPTIONS {
        return builder
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
            .body(Vec::new())
            .unwrap();
    }
    let result = resolve(root, request.uri().path()).and_then(|file| {
        std::fs::read(&file)
            .map(|body| (file, body))
            .map_err(|_| StatusCode::NOT_FOUND)
    });
    match result {
        Ok((file, body)) => builder
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime_type(&file))
            .body(body)
            .unwrap(),
        Err(status) => builder
            .status(status)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(
                status
                    .canonical_reason()
                    .unwrap_or("error")
                    .as_bytes()
                    .to_vec(),
            )
            .unwrap(),
    }
}

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let root = ctx
        .app_handle()
        .path()
        .app_data_dir()
        .map(|dir| dir.join("extensions"))
        .unwrap_or_default();
    std::thread::spawn(move || responder.respond(respond(&root, &request)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_unix_and_windows_paths() {
        assert_eq!(
            path_from_uri_path("/home/ana/ext%20one/index.js"),
            Some(PathBuf::from("/home/ana/ext one/index.js"))
        );
        assert_eq!(
            path_from_uri_path("/C:/Users/ana/x.js"),
            Some(PathBuf::from("C:/Users/ana/x.js"))
        );
        assert_eq!(path_from_uri_path("/bad%zz"), None);
    }

    #[test]
    fn serves_only_files_inside_the_root() {
        let base = std::env::temp_dir().join(format!("qori-ext-test-{}", std::process::id()));
        let root = base.join("extensions");
        std::fs::create_dir_all(root.join("acme.x/webview")).unwrap();
        std::fs::write(root.join("acme.x/webview/index.js"), "export {}").unwrap();
        std::fs::write(base.join("secret.txt"), "no").unwrap();
        let path = |p: &Path| p.to_string_lossy().replace('\\', "/");

        let ok = resolve(
            &root,
            &format!("/{}", path(&root.join("acme.x/webview/index.js"))).replace("//", "/"),
        );
        assert!(ok.is_ok());
        let escape = format!("/{}", path(&root.join("../secret.txt"))).replace("//", "/");
        assert_eq!(resolve(&root, &escape), Err(StatusCode::FORBIDDEN));
        let missing = format!("/{}", path(&root.join("nope.js"))).replace("//", "/");
        assert_eq!(resolve(&root, &missing), Err(StatusCode::NOT_FOUND));
        assert_eq!(
            mime_type(Path::new("a/index.JS")),
            "text/javascript; charset=utf-8"
        );

        let request = Request::builder()
            .uri(format!(
                "qori-ext://localhost/{}",
                path(&root.join("acme.x/webview/index.js")).trim_start_matches('/')
            ))
            .body(Vec::new())
            .unwrap();
        let response = respond(&root, &request);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(response.body(), b"export {}");
        std::fs::remove_dir_all(base).unwrap();
    }
}
