-- CreateTable
CREATE TABLE `ConversationSession` (
    `id` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'IDLE',
    `context` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ConversationSession_clubId_idx`(`clubId`),
    UNIQUE INDEX `ConversationSession_waId_clubId_key`(`waId`, `clubId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ConversationSession` ADD CONSTRAINT `ConversationSession_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
