use std::io::{self, Read, Write};

pub const MAX_MSG: usize = 1024 * 1024;

pub fn read_msg<R: Read>(r: &mut R) -> io::Result<Vec<u8>> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len)?;
    let n = u32::from_le_bytes(len) as usize;
    if n > MAX_MSG {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "msg exceeds 1 MiB"));
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

pub fn write_msg<W: Write>(w: &mut W, msg: &[u8]) -> io::Result<()> {
    if msg.len() > MAX_MSG {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "msg exceeds 1 MiB"));
    }
    let len = (msg.len() as u32).to_le_bytes();
    w.write_all(&len)?;
    w.write_all(msg)?;
    w.flush()
}
