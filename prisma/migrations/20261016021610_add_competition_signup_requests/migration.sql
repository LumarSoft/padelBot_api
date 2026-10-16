-- CreateTable
CREATE TABLE `CompetitionSignupRequest` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(32) NOT NULL,
    `playerName` VARCHAR(100) NULL,
    `status` ENUM('PENDING', 'HANDLED', 'DISMISSED') NOT NULL DEFAULT 'PENDING',
    `handledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionSignupRequest_clubId_status_idx`(`clubId`, `status`),
    INDEX `CompetitionSignupRequest_competitionId_idx`(`competitionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CompetitionSignupRequest` ADD CONSTRAINT `CompetitionSignupRequest_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionSignupRequest` ADD CONSTRAINT `CompetitionSignupRequest_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
