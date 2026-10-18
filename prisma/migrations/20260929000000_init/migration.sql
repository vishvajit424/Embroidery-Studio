-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "Store" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "topPrice" DECIMAL NOT NULL DEFAULT 299,
    "bottomPrice" DECIMAL NOT NULL DEFAULT 199,
    "logoPrice" DECIMAL NOT NULL DEFAULT 250,
    "bundlePrice" DECIMAL NOT NULL DEFAULT 598,
    "bundleCompareAt" DECIMAL NOT NULL DEFAULT 748,
    "uploadMaxMb" INTEGER NOT NULL DEFAULT 5,
    "topVariantId" TEXT,
    "bottomVariantId" TEXT,
    "logoVariantId" TEXT,
    "bundleVariantId" TEXT,
    "librarySyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProductEmbroideryConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL DEFAULT '',
    "productHandle" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "topEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bottomEnabled" BOOLEAN NOT NULL DEFAULT true,
    "logoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bundleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "topPrice" DECIMAL NOT NULL DEFAULT 299,
    "bottomPrice" DECIMAL NOT NULL DEFAULT 199,
    "logoPrice" DECIMAL NOT NULL DEFAULT 250,
    "bundlePrice" DECIMAL NOT NULL DEFAULT 598,
    "bundleCompareAt" DECIMAL NOT NULL DEFAULT 748,
    "topPosition" TEXT NOT NULL DEFAULT 'leftChest',
    "iconPosition" TEXT NOT NULL DEFAULT 'rightChest',
    "bottomPosition" TEXT NOT NULL DEFAULT 'leftSide',
    "positionOverrides" TEXT NOT NULL DEFAULT '{}',
    "bottomImageUrl" TEXT,
    "uploadMaxSize" INTEGER NOT NULL DEFAULT 5,
    "requireName" BOOLEAN NOT NULL DEFAULT true,
    "maxChars" INTEGER NOT NULL DEFAULT 22,
    "topVariantId" TEXT,
    "bottomVariantId" TEXT,
    "logoVariantId" TEXT,
    "bundleVariantId" TEXT,
    "syncedAt" DATETIME,
    "syncError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductEmbroideryConfig_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmbroideryOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "EmbroideryOption_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmbroideryIcon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "fileId" TEXT,
    "placement" TEXT NOT NULL DEFAULT 'top',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbroideryIcon_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmbroideryFont" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cssFamily" TEXT NOT NULL,
    "stylesheetUrl" TEXT,
    "previewText" TEXT NOT NULL DEFAULT 'Your Name',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbroideryFont_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmbroideryColor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbroideryColor_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmbroideryPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT 'top',
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "width" REAL NOT NULL,
    "rotation" REAL NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "EmbroideryPosition_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "fileId" TEXT,
    "url" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Upload_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmbroideryOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "productId" TEXT,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "hasLogo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbroideryOrderLine_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_shop_key" ON "Store"("shop");

-- CreateIndex
CREATE INDEX "ProductEmbroideryConfig_shop_enabled_idx" ON "ProductEmbroideryConfig"("shop", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEmbroideryConfig_shop_productId_key" ON "ProductEmbroideryConfig"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "EmbroideryOption_shop_key_key" ON "EmbroideryOption"("shop", "key");

-- CreateIndex
CREATE INDEX "EmbroideryIcon_shop_idx" ON "EmbroideryIcon"("shop");

-- CreateIndex
CREATE INDEX "EmbroideryFont_shop_idx" ON "EmbroideryFont"("shop");

-- CreateIndex
CREATE INDEX "EmbroideryColor_shop_idx" ON "EmbroideryColor"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "EmbroideryPosition_shop_key_key" ON "EmbroideryPosition"("shop", "key");

-- CreateIndex
CREATE INDEX "Upload_shop_createdAt_idx" ON "Upload"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "EmbroideryOrderLine_shop_type_idx" ON "EmbroideryOrderLine"("shop", "type");

-- CreateIndex
CREATE UNIQUE INDEX "EmbroideryOrderLine_shop_lineItemId_key" ON "EmbroideryOrderLine"("shop", "lineItemId");
