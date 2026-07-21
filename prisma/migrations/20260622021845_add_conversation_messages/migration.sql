-- AlterTable
ALTER TABLE `ConversationSession` ADD COLUMN `mode` VARCHAR(191) NOT NULL DEFAULT 'AI',
    ADD COLUMN `playerName` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ConversationMessage` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConversationMessage_sessionId_idx`(`sessionId`),
    INDEX `ConversationMessage_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ConversationMessage` ADD CONSTRAINT `ConversationMessage_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ConversationSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
