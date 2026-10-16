-- CreateTable
CREATE TABLE `Improvement` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('PLANNED', 'IN_PROGRESS', 'RELEASED') NOT NULL DEFAULT 'RELEASED',
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Improvement_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImprovementSuggestion` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `userId` INTEGER NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('NEW', 'UNDER_REVIEW', 'PLANNED', 'DONE', 'DECLINED') NOT NULL DEFAULT 'NEW',
    `opsReply` TEXT NULL,
    `repliedAt` DATETIME(3) NULL,
    `improvementId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImprovementSuggestion_clubId_createdAt_idx`(`clubId`, `createdAt`),
    INDEX `ImprovementSuggestion_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ImprovementSuggestion_improvementId_idx`(`improvementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ImprovementSuggestion` ADD CONSTRAINT `ImprovementSuggestion_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImprovementSuggestion` ADD CONSTRAINT `ImprovementSuggestion_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImprovementSuggestion` ADD CONSTRAINT `ImprovementSuggestion_improvementId_fkey` FOREIGN KEY (`improvementId`) REFERENCES `Improvement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
