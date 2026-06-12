/**
 * Seed script — creates a demo user + project with a small amount of MOCK
 * connectivity/BOM data so the dashboard tabs render something meaningful in
 * Phase 1. None of this is real company data.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // --- demo user -----------------------------------------------------------
  const user = await prisma.user.upsert({
    where: { email: "demo@resistance.local" },
    update: {},
    create: { email: "demo@resistance.local", name: "Demo Engineer" },
  });

  // --- demo project --------------------------------------------------------
  // Clean any previous demo project so seeding is idempotent.
  await prisma.project.deleteMany({ where: { name: "Demo Power Board" } });

  const project = await prisma.project.create({
    data: {
      name: "Demo Power Board",
      description:
        "Sample project with mock netlist/BOM data to exercise the Phase 1 UI.",
      ownerId: user.id,
    },
  });

  // --- components ----------------------------------------------------------
  const u7 = await prisma.component.create({
    data: {
      projectId: project.id,
      refDes: "U7",
      name: "TPS54331",
      description: "3A Step-Down Regulator",
      footprint: "SOIC-8",
    },
  });
  const r12 = await prisma.component.create({
    data: {
      projectId: project.id,
      refDes: "R12",
      name: "Resistor",
      value: "10k",
      footprint: "0402",
    },
  });
  const c5 = await prisma.component.create({
    data: {
      projectId: project.id,
      refDes: "C5",
      name: "Capacitor",
      value: "100nF",
      footprint: "0402",
    },
  });

  // --- nets ----------------------------------------------------------------
  const net5v = await prisma.net.create({
    data: { projectId: project.id, name: "5V" },
  });
  const netGnd = await prisma.net.create({
    data: { projectId: project.id, name: "GND" },
  });

  // --- pins + connections --------------------------------------------------
  // Helper: create a pin and wire it to a net via a Connection.
  async function pin(
    component: { id: string },
    number: string,
    name: string,
    net: { id: string }
  ) {
    const p = await prisma.pin.create({
      data: { componentId: component.id, number, name },
    });
    await prisma.connection.create({
      data: { pinId: p.id, netId: net.id },
    });
    return p;
  }

  await pin(u7, "1", "VIN", net5v);
  await pin(u7, "4", "GND", netGnd);
  await pin(r12, "1", "A", net5v);
  await pin(c5, "1", "A", net5v);
  await pin(c5, "2", "B", netGnd);

  // --- BOM items (many-to-many with components) ----------------------------
  await prisma.bomItem.create({
    data: {
      projectId: project.id,
      refDesRaw: "U7",
      description: "3A Step-Down Regulator",
      manufacturer: "Texas Instruments",
      mpn: "TPS54331DR",
      quantity: 1,
      components: { connect: [{ id: u7.id }] },
    },
  });
  await prisma.bomItem.create({
    data: {
      projectId: project.id,
      refDesRaw: "R12",
      description: "Resistor 10k 1%",
      manufacturer: "Yageo",
      mpn: "RC0402FR-0710KL",
      value: "10k",
      quantity: 1,
      components: { connect: [{ id: r12.id }] },
    },
  });

  // --- document chunk (placeholder for RAG) --------------------------------
  await prisma.documentChunk.create({
    data: {
      projectId: project.id,
      chunkIndex: 0,
      content:
        "Requirement: The 5V rail shall supply up to 3A continuous with <1% ripple.",
      metadata: JSON.stringify({ source: "seed", section: "power" }),
    },
  });

  console.log(`Seeded project "${project.name}" (${project.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
