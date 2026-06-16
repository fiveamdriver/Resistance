/**
 * Altium binary document support (.SchDoc / .PcbDoc).
 *
 * Modern Altium Designer schematic (.SchDoc) and PCB (.PcbDoc) files are
 * Microsoft Compound File Binary (CFB / OLE2) containers — proprietary binary,
 * not text. Phase 1 supports *importing* them: validating that an upload is a
 * genuine Altium binary, then storing it. Extracting connectivity (nets,
 * components, pins) from the binary records is a substantial reverse-engineering
 * effort and is intentionally deferred.
 *
 * TODO(future): parse the CFB streams to extract a connectivity graph. Until
 * then, the practical path to connectivity is Altium's netlist export (.net),
 * which `netlistParser` already handles.
 */
import { open } from "fs/promises";

/** OLE2 / CFB compound-file magic number (first 8 bytes). */
const OLE2_MAGIC = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

/** True if the buffer begins with the OLE2/CFB magic header. */
export function isOle2Header(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE2_MAGIC);
}

/**
 * Verify that the file at `filePath` is a genuine Altium binary (OLE2 container).
 * Reads only the first 8 bytes — safe for large .PcbDoc files. Throws with a
 * user-safe message if the file isn't a recognized Altium binary.
 */
export async function assertAltiumBinary(filePath: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(8), 0, 8, 0);
    if (!isOle2Header(buffer.subarray(0, bytesRead))) {
      throw new Error(
        "Not a recognized Altium binary. .SchDoc/.PcbDoc must be Altium Designer compound (OLE2) files."
      );
    }
  } finally {
    await handle.close();
  }
}
