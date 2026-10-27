-- Kiosk stock: per-product on-hand quantity (null = not tracked), the entra/sale/queda ledger and
-- counter sales outside a turno.
-- AlterTable
ALTER TABLE `Product` ADD COLUMN `lowStockNotifiedAt` DATETIME(3) NULL,
    ADD COLUMN `lowStockThreshold` INTEGER NULL,
    ADD COLUMN `stockQuantity` INTEGER NULL;

-- CreateTable
CREATE TABLE `StockMovement` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `type` ENUM('PURCHASE', 'SALE', 'ADJUSTMENT') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `stockAfter` INTEGER NOT NULL,
    `note` VARCHAR(200) NULL,
    `userId` INTEGER NULL,
    `bookingId` VARCHAR(191) NULL,
    `counterSaleId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockMovement_clubId_productId_createdAt_idx`(`clubId`, `productId`, `createdAt`),
    INDEX `StockMovement_bookingId_idx`(`bookingId`),
    INDEX `StockMovement_counterSaleId_idx`(`counterSaleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CounterSale` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPriceCents` INTEGER NOT NULL,
    `method` ENUM('CASH', 'QR', 'TRANSFER') NOT NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CounterSale_clubId_createdAt_idx`(`clubId`, `createdAt`),
    INDEX `CounterSale_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StockMovement` ADD CONSTRAINT `StockMovement_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockMovement` ADD CONSTRAINT `StockMovement_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockMovement` ADD CONSTRAINT `StockMovement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockMovement` ADD CONSTRAINT `StockMovement_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockMovement` ADD CONSTRAINT `StockMovement_counterSaleId_fkey` FOREIGN KEY (`counterSaleId`) REFERENCES `CounterSale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CounterSale` ADD CONSTRAINT `CounterSale_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CounterSale` ADD CONSTRAINT `CounterSale_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CounterSale` ADD CONSTRAINT `CounterSale_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

