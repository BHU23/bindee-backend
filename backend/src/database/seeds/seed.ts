import { prisma } from "@/database/client/prisma.js";
import { runSeed } from "./runSeed.js";

try {
  const summary = await runSeed(prisma);
  console.log("Seed complete", summary);
} finally {
  await prisma.$disconnect();
}
