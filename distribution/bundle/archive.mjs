import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** Stable ustar metadata makes unchanged assembled bytes reproducible. */
export function archiveDirectory(directory, archive) {
  const chunks = [];
  const root = path.basename(directory);
  function add(filename, relative) {
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(filename).sort()) add(path.join(filename, name), `${relative}/${name}`);
      return;
    }
    const header = Buffer.alloc(512);
    let name = relative;
    if (Buffer.byteLength(name) > 100) {
      let cut = name.length;
      do { cut = name.lastIndexOf('/', cut - 1); } while (cut > 0 && Buffer.byteLength(name.slice(cut + 1)) > 100);
      if (cut <= 0 || Buffer.byteLength(name.slice(0, cut)) > 155) throw new Error(`Archive path exceeds ustar limits: ${relative}`);
      header.write(name.slice(0, cut), 345, 155);
      name = name.slice(cut + 1);
    }
    header.write(name, 0, 100);
    const octal = (value, offset, size) => header.write(`${value.toString(8).padStart(size - 1, '0')}\0`, offset, size);
    octal(stat.mode & 0o777, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    const contents = stat.isSymbolicLink() ? Buffer.alloc(0) : fs.readFileSync(filename);
    octal(contents.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write(stat.isSymbolicLink() ? '2' : '0', 156, 1);
    if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(filename);
      if (Buffer.byteLength(link) > 100 || path.isAbsolute(link)) throw new Error(`Archive requires a short relative link: ${relative}`);
      header.write(link, 157, 100);
    }
    header.write('ustar\0', 257, 6); header.write('00', 263, 2);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    chunks.push(header, contents, Buffer.alloc((512 - contents.length % 512) % 512));
  }
  add(directory, root);
  chunks.push(Buffer.alloc(1024));
  fs.writeFileSync(archive, gzipSync(Buffer.concat(chunks), { level: 9 }));
}
