-- CreateTable
CREATE TABLE "pastes" (
    "key" VARCHAR(64) NOT NULL,
    "blob_url" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "language" VARCHAR(32),
    "visibility" VARCHAR(10) NOT NULL DEFAULT 'unlisted',
    "owner_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "burn_after_read" BOOLEAN NOT NULL DEFAULT false,
    "view_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pastes_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "pastes_owner_id_idx" ON "pastes"("owner_id");

-- CreateIndex
CREATE INDEX "pastes_expires_at_idx" ON "pastes"("expires_at");
