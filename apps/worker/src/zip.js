/**
 * Minimal in-memory ZIP archive builder (no external dependencies).
 * Supports standard ZIP format (compression method: Store / 0x00).
 */
export class SimpleZip {
  constructor() {
    this.files = [];
  }

  static crc32(buffer) {
    if (!SimpleZip._crcTable) {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
      }
      SimpleZip._crcTable = table;
    }
    let crc = 0xFFFFFFFF;
    const table = SimpleZip._crcTable;
    for (let i = 0; i < buffer.length; i++) {
      crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  addFile(path, content) {
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const data = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : (content instanceof Uint8Array ? content : new Uint8Array(content));
    this.files.push({ path: cleanPath, data });
  }

  generateUint8Array() {
    const encoder = new TextEncoder();
    const entries = [];
    let localOffset = 0;
    const localHeadersAndData = [];

    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    for (const file of this.files) {
      const nameBytes = encoder.encode(file.path);
      const crc = SimpleZip.crc32(file.data);
      const size = file.data.length;

      // Local file header (30 bytes + name length)
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);  // Local file header signature
      lv.setUint16(4, 20, true);          // Version needed to extract (2.0)
      lv.setUint16(6, 0, true);           // General purpose bit flag
      lv.setUint16(8, 0, true);           // Compression method (0 = stored)
      lv.setUint16(10, dosTime, true);    // Last mod file time
      lv.setUint16(12, dosDate, true);    // Last mod file date
      lv.setUint32(14, crc, true);        // CRC-32
      lv.setUint32(18, size, true);       // Compressed size
      lv.setUint32(22, size, true);       // Uncompressed size
      lv.setUint16(26, nameBytes.length, true); // File name length
      lv.setUint16(28, 0, true);          // Extra field length
      localHeader.set(nameBytes, 30);

      entries.push({
        path: file.path,
        nameBytes,
        crc,
        size,
        offset: localOffset,
        dosTime,
        dosDate,
      });

      localHeadersAndData.push(localHeader);
      localHeadersAndData.push(file.data);
      localOffset += localHeader.length + size;
    }

    // Central Directory
    const centralOffset = localOffset;
    const cdEntries = [];
    let cdSize = 0;

    for (const entry of entries) {
      const cdHeader = new Uint8Array(46 + entry.nameBytes.length);
      const cv = new DataView(cdHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);  // Central directory header signature
      cv.setUint16(4, 20, true);          // Version made by
      cv.setUint16(6, 20, true);          // Version needed
      cv.setUint16(8, 0, true);           // General purpose bit flag
      cv.setUint16(10, 0, true);          // Compression method
      cv.setUint16(12, entry.dosTime, true);
      cv.setUint16(14, entry.dosDate, true);
      cv.setUint32(16, entry.crc, true);
      cv.setUint32(20, entry.size, true);
      cv.setUint32(24, entry.size, true);
      cv.setUint16(28, entry.nameBytes.length, true);
      cv.setUint16(30, 0, true);          // Extra field length
      cv.setUint16(32, 0, true);          // Comment length
      cv.setUint16(34, 0, true);          // Disk number start
      cv.setUint16(36, 0, true);          // Internal file attributes
      cv.setUint32(38, 0, true);          // External file attributes
      cv.setUint32(42, entry.offset, true);// Relative offset of local header
      cdHeader.set(entry.nameBytes, 46);

      cdEntries.push(cdHeader);
      cdSize += cdHeader.length;
    }

    // End of Central Directory Record (22 bytes)
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);    // EOCD signature
    ev.setUint16(4, 0, true);            // Disk number
    ev.setUint16(6, 0, true);            // Start disk
    ev.setUint16(8, entries.length, true);  // Records on this disk
    ev.setUint16(10, entries.length, true); // Total records
    ev.setUint32(12, cdSize, true);        // Size of central directory
    ev.setUint32(16, centralOffset, true); // Offset of central directory
    ev.setUint16(20, 0, true);            // Comment length

    // Assemble all pieces into a single buffer
    const totalLength = centralOffset + cdSize + eocd.length;
    const finalBuffer = new Uint8Array(totalLength);
    let writeOffset = 0;

    for (const chunk of localHeadersAndData) {
      finalBuffer.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }
    for (const chunk of cdEntries) {
      finalBuffer.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }
    finalBuffer.set(eocd, writeOffset);

    return finalBuffer;
  }
}
