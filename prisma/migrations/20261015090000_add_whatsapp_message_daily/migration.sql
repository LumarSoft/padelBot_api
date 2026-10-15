-- A club's credits are now the messages its bot sends on WhatsApp (replies, reminders, fijo
-- confirmations), not AI steps: Meta bills us per message and the AI is cheap. This table
-- counts the messages the Graph API accepted, per number and day, split so it can also give
-- our Meta cost (service messages past the free tier per number, plus every utility template).

-- CreateTable
CREATE TABLE `WhatsAppMessageDaily` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `phoneNumberId` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(191) NOT NULL,
    `botService` INTEGER NOT NULL DEFAULT 0,
    `staffService` INTEGER NOT NULL DEFAULT 0,
    `utility` INTEGER NOT NULL DEFAULT 0,
    `packCredits` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppMessageDaily_clubId_dateKey_idx`(`clubId`, `dateKey`),
    INDEX `WhatsAppMessageDaily_dateKey_idx`(`dateKey`),
    UNIQUE INDEX `WhatsAppMessageDaily_phoneNumberId_dateKey_key`(`phoneNumberId`, `dateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WhatsAppMessageDaily` ADD CONSTRAINT `WhatsAppMessageDaily_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
