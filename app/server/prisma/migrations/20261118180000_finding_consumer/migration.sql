CREATE TABLE "FindingConsumer" (
    "findingId" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    PRIMARY KEY ("findingId", "consumerId"),
    CONSTRAINT "FindingConsumer_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FindingConsumer_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "Consumer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FindingConsumer_consumerId_idx" ON "FindingConsumer"("consumerId");
