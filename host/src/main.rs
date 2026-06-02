use std::io;
use zpwr_chrome_host::{dispatch::dispatch, frame, proto::{Request, Response}};

const HELP: &str = "\
zpwr-chrome-host — native messaging host for the zpwrchrome browser extension

USAGE:
    zpwr-chrome-host                 read framed JSON requests on stdin (the
                                     mode Chrome invokes via the native-
                                     messaging manifest); see host/install.sh
    zpwr-chrome-host --version       print version and exit
    zpwr-chrome-host --help          print this help and exit

Channels: pass (list/match/fetch/otp) + dl (add/list/pause/resume/cancel).
Repo:     https://github.com/MenkeTechnologies/zpwrchrome
";

fn main() {
    if let Some(arg) = std::env::args().nth(1) {
        match arg.as_str() {
            "--version" | "-V" => {
                println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
                return;
            }
            "--help" | "-h" => {
                print!("{HELP}");
                return;
            }
            _ => {
                eprintln!("zpwr-chrome-host: unknown argument: {arg}\nrun --help for usage");
                std::process::exit(2);
            }
        }
    }
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut sin = stdin.lock();
    let mut sout = stdout.lock();

    loop {
        let buf = match frame::read_msg(&mut sin) {
            Ok(b) => b,
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return,
            Err(e) => {
                eprintln!("zpwr-chrome-host: read: {e}");
                return;
            }
        };

        let resp = match serde_json::from_slice::<Request>(&buf) {
            Ok(req) => dispatch(req),
            Err(e) => Response::err(0, format!("parse: {e}")),
        };

        let bytes = match serde_json::to_vec(&resp) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("zpwr-chrome-host: encode: {e}");
                return;
            }
        };

        if let Err(e) = frame::write_msg(&mut sout, &bytes) {
            if e.kind() == io::ErrorKind::BrokenPipe {
                return;
            }
            eprintln!("zpwr-chrome-host: write: {e}");
            return;
        }
    }
}
