-- Extra credit packs bought with MercadoPago Checkout Pro (paid into Lumarsoft's account).
-- Credited when MP approves the payment, spent after the month's plan credits (soonest expiry
-- first) and valid for 6 months.

-- CreateTable
CREATE TABLE `CreditPackPurchase` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `packKey` VARCHAR(191) NOT NULL,
    `credits` INTEGER NOT NULL,
    `priceCents` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `creditsUsed` INTEGER NOT NULL DEFAULT 0,
    `mpPreferenceId` VARCHAR(191) NULL,
    `mpPaymentId` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CreditPackPurchase_mpPaymentId_key`(`mpPaymentId`),
    INDEX `CreditPackPurchase_clubId_status_idx`(`clubId`, `status`),
    INDEX `CreditPackPurchase_approvedAt_idx`(`approvedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CreditPackPurchase` ADD CONSTRAINT `CreditPackPurchase_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
