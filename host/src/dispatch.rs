use crate::proto::{Request, Response};
use serde_json::json;

pub fn dispatch(req: Request) -> Response {
    match req.kind.as_str() {
        "meta" => meta(req),
        "echo" => echo(req),
        "pass" => crate::pass::dispatch_pass(req),
        "dl"   => crate::dl::dispatch_dl(req),
        other => Response::err(req.id, format!("unknown kind: {other}")),
    }
}

fn meta(req: Request) -> Response {
    Response::ok(
        req.id,
        json!({
            "name": env!("CARGO_PKG_NAME"),
            "version": env!("CARGO_PKG_VERSION"),
        }),
    )
}

fn echo(req: Request) -> Response {
    Response::ok(req.id, req.args)
}
