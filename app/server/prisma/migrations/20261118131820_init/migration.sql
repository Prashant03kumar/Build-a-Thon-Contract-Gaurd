-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SpecVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "publishOrder" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "raw" TEXT,
    "canonical" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecVersion_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Consumer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConsumerUse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "consumerId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "pathRaw" TEXT NOT NULL,
    "pathNorm" TEXT NOT NULL,
    "sendsJson" TEXT NOT NULL,
    "readsJson" TEXT NOT NULL,
    CONSTRAINT "ConsumerUse_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "Consumer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "fromVersion" TEXT,
    "toVersion" TEXT,
    "consumer" TEXT,
    "severity" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_name_key" ON "Provider"("name");

-- CreateIndex
CREATE INDEX "SpecVersion_providerId_idx" ON "SpecVersion"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecVersion_providerId_publishOrder_key" ON "SpecVersion"("providerId", "publishOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Consumer_name_key" ON "Consumer"("name");

-- CreateIndex
CREATE INDEX "ConsumerUse_providerName_method_pathNorm_idx" ON "ConsumerUse"("providerName", "method", "pathNorm");

-- CreateIndex
CREATE INDEX "Finding_severity_provider_idx" ON "Finding"("severity", "provider");

-- CreateIndex
CREATE INDEX "Finding_notified_idx" ON "Finding"("notified");
