//! Port of `helpers/helpers.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. Each Go fn ports with the same name (PascalCase preserved
//! to mirror Go's exported names), same parameters, same control flow, same
//! gpg invocation flags. Go inline comments carry over.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use std::fs;
use std::io::{self, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

/// Port of `DetectGpgBinary()` from `helpers/helpers.go:15`.
pub fn DetectGpgBinary() -> Result<String, String> {
    // Look in $PATH first, then check common locations - the first             // go:16
    // successful result wins                                                   // go:17
    let gpgBinaryPriorityList: &[&str] = &[                                     // go:18
        "gpg2", "gpg",                                                          // go:19
        "/bin/gpg2", "/usr/bin/gpg2", "/usr/local/bin/gpg2",                    // go:20
        "/bin/gpg",  "/usr/bin/gpg",  "/usr/local/bin/gpg",                     // go:21
    ];

    for binary in gpgBinaryPriorityList {                                       // go:24
        let err = ValidateGpgBinary(binary);                                    // go:25
        if err.is_ok() {                                                        // go:26
            return Ok(binary.to_string());                                      // go:27
        }
    }
    Err("Unable to detect the location of the gpg binary to use".to_string())   // go:30
}

/// Port of `ValidateGpgBinary()` from `helpers/helpers.go:33`.
pub fn ValidateGpgBinary(gpgPath: &str) -> Result<(), String> {
    let status = Command::new(gpgPath)
        .arg("--version")                                                       // go:34 exec.Command(gpgPath, "--version").Run()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("gpg --version exited {s}")),
        Err(e) => Err(format!("spawn {gpgPath}: {e}")),
    }
}

/// Port of `GpgDecryptFile()` from `helpers/helpers.go:37`.
pub fn GpgDecryptFile(filePath: &Path, gpgPath: &str) -> Result<String, String> {
    let passwordFile = fs::File::open(filePath)                                 // go:38 os.Open(filePath)
        .map_err(|e| format!("{e}"))?;                                          // go:39-41

    let gpgOptions: &[&str] = &["--decrypt", "--yes", "--quiet", "--batch", "-"]; // go:44

    let mut cmd = Command::new(gpgPath)                                         // go:46 exec.Command(gpgPath, gpgOptions...)
        .args(gpgOptions)
        .stdin(Stdio::from(passwordFile))                                       // go:47 cmd.Stdin = passwordFile
        .stdout(Stdio::piped())                                                 // go:48 cmd.Stdout = &stdout
        .stderr(Stdio::piped())                                                 // go:49 cmd.Stderr = &stderr
        .spawn()
        .map_err(|e| format!("spawn gpg: {e}"))?;
    let mut stdout = String::new();                                             // go:43 var stdout
    let mut stderr = String::new();                                             // go:43 var stderr
    if let Some(mut s) = cmd.stdout.take() {
        s.read_to_string(&mut stdout).map_err(|e| format!("read stdout: {e}"))?;
    }
    if let Some(mut s) = cmd.stderr.take() {
        s.read_to_string(&mut stderr).map_err(|e| format!("read stderr: {e}"))?;
    }
    let status = cmd.wait().map_err(|e| format!("wait: {e}"))?;
    if !status.success() {                                                      // go:51 cmd.Run() != nil
        return Err(format!("Error: gpg exited {status}, Stderr: {stderr}"));     // go:52
    }

    Ok(stdout)                                                                   // go:55 stdout.String()
}

/// Port of `GpgEncryptFile()` from `helpers/helpers.go:58`.
pub fn GpgEncryptFile(
    filePath: &Path,
    contents: &str,
    recipients: &[String],
    gpgPath: &str,
) -> Result<(), String> {
    if let Some(parent) = filePath.parent() {                                   // go:59 os.MkdirAll(filepath.Dir(filePath), 0755)
        fs::create_dir_all(parent)
            .map_err(|e| format!("Unable to create directory structure: {e}"))?; // go:60-62
    }

    let mut gpgOptions: Vec<String> = vec![                                     // go:65
        "--encrypt".into(),                                                     // go:65
        "--yes".into(),                                                         // go:65
        "--quiet".into(),                                                       // go:65
        "--batch".into(),                                                       // go:65
        "--output".into(), filePath.to_string_lossy().into_owned(),             // go:65
    ];
    for recipient in recipients {                                               // go:66
        gpgOptions.push("--recipient".into());                                  // go:67
        gpgOptions.push(recipient.clone());                                     // go:67
    }

    let mut cmd = Command::new(gpgPath)                                         // go:70 exec.Command(gpgPath, gpgOptions...)
        .args(gpgOptions.iter().map(String::as_str))
        .stdin(Stdio::piped())                                                  // go:71 cmd.Stdin = strings.NewReader(contents)
        .stdout(Stdio::piped())                                                 // go:72 cmd.Stdout = &stdout
        .stderr(Stdio::piped())                                                 // go:73 cmd.Stderr = &stderr
        .spawn()
        .map_err(|e| format!("spawn gpg: {e}"))?;
    if let Some(mut s) = cmd.stdin.take() {
        s.write_all(contents.as_bytes())
            .map_err(|e| format!("write stdin: {e}"))?;
    }
    let mut stderr = String::new();                                             // go:64 var stderr
    if let Some(mut s) = cmd.stderr.take() {
        s.read_to_string(&mut stderr).ok();
    }
    let status = cmd.wait().map_err(|e| format!("wait: {e}"))?;
    if !status.success() {                                                      // go:75 cmd.Run() != nil
        return Err(format!("Error: gpg exited {status}, Stderr: {stderr}"));     // go:76
    }

    Ok(())                                                                       // go:79
}

/// Port of `DetectGpgRecipients()` from `helpers/helpers.go:82`.
pub fn DetectGpgRecipients(filePath: &Path) -> Result<Vec<String>, String> {
    let mut dir = filePath                                                       // go:83 dir := filepath.Dir(filePath)
        .parent()
        .ok_or_else(|| "file has no parent".to_string())?
        .to_path_buf();
    loop {                                                                       // go:84 for {
        let file = fs::read_to_string(dir.join(".gpg-id"));                      // go:85 ioutil.ReadFile(filepath.Join(dir, ".gpg-id"))
        match file {                                                             // go:86 if err == nil { ... }
            Ok(body) => {
                let normalized = body                                            // go:87 strings.Split(strings.ReplaceAll(strings.TrimSpace(string(file)), "\r\n", "\n"), "\n")
                    .replace("\r\n", "\n");
                return Ok(normalized
                    .trim()
                    .split('\n')
                    .filter(|l| !l.is_empty())
                    .map(|l| l.to_string())
                    .collect());
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}                  // go:90 !os.IsNotExist(err)
            Err(e) => {                                                          // go:91-92
                return Err(format!("Unable to open `.gpg-id` file: {e}"));       // go:91
            }
        }

        let parentDir = dir.parent().map(|p| p.to_path_buf());                   // go:95 parentDir := filepath.Dir(dir)
        match parentDir {                                                        // go:96 if parentDir == dir
            Some(p) if p != dir => dir = p,                                      // go:99 dir = parentDir
            _ => return Err("Unable to find '.gpg-id' file".to_string()),        // go:97
        }
    }
}

/// Port of `IsDirectoryEmpty()` from `helpers/helpers.go:104`.
pub fn IsDirectoryEmpty(dirPath: &Path) -> io::Result<bool> {
    let mut f = fs::read_dir(dirPath)?;                                          // go:105 os.Open(dirPath)
    // defer f.Close()                                                           // go:109 (Rust drops f at end of scope)

    match f.next() {                                                             // go:111 f.Readdirnames(1)
        None => Ok(true),                                                        // go:112 err == io.EOF → true
        Some(Err(e)) => Err(e),
        Some(Ok(_)) => Ok(false),                                                // go:115 false, err
    }
}

#[allow(non_snake_case)]
const _: () = ();
