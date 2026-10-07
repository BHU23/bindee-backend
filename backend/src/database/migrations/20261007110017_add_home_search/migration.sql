-- CreateTable
CREATE TABLE "recent_search" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "query_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "searched_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recent_search_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "origin_code" TEXT NOT NULL,
    "destination_code" TEXT NOT NULL,
    "promo_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recent_search_session_id_searched_at_idx" ON "recent_search"("session_id", "searched_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "recent_search_session_id_query_key_key" ON "recent_search"("session_id", "query_key");

-- CreateIndex
CREATE INDEX "promotion_promo_code_idx" ON "promotion"("promo_code");

-- AddForeignKey
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_promo_code_fkey" FOREIGN KEY ("promo_code") REFERENCES "promo_code"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
