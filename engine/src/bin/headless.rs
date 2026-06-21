//! Stdio driver — NDJSON commands in, NDJSON events out.

use std::io::{self, BufRead, Write};

use daw_engine::protocol::{Command, Event};
use daw_engine::Daw;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let mut daw = Daw::new();

    // Announce readiness.
    emit(&mut out, &Event::Ready {
        version: format!("daw-engine {VERSION}"),
    });

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break, // EOF / read error
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match Command::parse(trimmed) {
            Ok(cmd) => {
                let is_quit = matches!(cmd, Command::Quit { .. });
                for ev in daw.handle(cmd) {
                    emit(&mut out, &ev);
                }
                if is_quit {
                    return;
                }
            }
            Err(e) => {
                emit(&mut out, &Event::Error {
                    message: e.to_string(),
                    id: None,
                });
            }
        }
    }
    // EOF: exit cleanly.
}

fn emit<W: Write>(out: &mut W, ev: &Event) {
    let _ = writeln!(out, "{}", ev.to_line());
    let _ = out.flush();
}
