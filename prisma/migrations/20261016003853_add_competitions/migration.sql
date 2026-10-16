-- AlterTable
ALTER TABLE `Slot` ADD COLUMN `competitionId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Competition` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `kind` ENUM('TOURNAMENT', 'PENA') NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'FINISHED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `matchFormat` ENUM('ONE_SET', 'BEST_OF_THREE') NOT NULL DEFAULT 'ONE_SET',
    `entryFeeCents` INTEGER NOT NULL DEFAULT 0,
    `createdByUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Competition_clubId_idx`(`clubId`),
    INDEX `Competition_clubId_kind_status_idx`(`clubId`, `kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionSession` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(10) NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionSession_clubId_idx`(`clubId`),
    INDEX `CompetitionSession_competitionId_idx`(`competitionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionCourt` (
    `clubId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NOT NULL,
    `courtId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionCourt_clubId_idx`(`clubId`),
    INDEX `CompetitionCourt_courtId_idx`(`courtId`),
    PRIMARY KEY (`competitionId`, `courtId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionCategory` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `format` ENUM('ROUND_ROBIN', 'GROUPS_KNOCKOUT', 'KNOCKOUT') NOT NULL,
    `groupSize` INTEGER NOT NULL DEFAULT 3,
    `advancePerGroup` INTEGER NOT NULL DEFAULT 2,
    `maxPairs` INTEGER NULL,
    `fixtureGeneratedAt` DATETIME(3) NULL,
    `bracketGeneratedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionCategory_clubId_idx`(`clubId`),
    INDEX `CompetitionCategory_competitionId_idx`(`competitionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionGroup` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(30) NOT NULL,
    `position` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionGroup_clubId_idx`(`clubId`),
    INDEX `CompetitionGroup_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionPair` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NULL,
    `seed` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionPair_clubId_idx`(`clubId`),
    INDEX `CompetitionPair_competitionId_idx`(`competitionId`),
    INDEX `CompetitionPair_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionPlayer` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NOT NULL,
    `pairId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `playerId` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `paymentMethod` ENUM('CASH', 'QR', 'TRANSFER') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionPlayer_clubId_idx`(`clubId`),
    INDEX `CompetitionPlayer_competitionId_idx`(`competitionId`),
    INDEX `CompetitionPlayer_playerId_idx`(`playerId`),
    UNIQUE INDEX `CompetitionPlayer_pairId_position_key`(`pairId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionMatch` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `stage` ENUM('GROUP', 'KNOCKOUT') NOT NULL,
    `groupId` VARCHAR(191) NULL,
    `round` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `pairAId` VARCHAR(191) NULL,
    `pairBId` VARCHAR(191) NULL,
    `placeholderA` VARCHAR(40) NULL,
    `placeholderB` VARCHAR(40) NULL,
    `courtId` VARCHAR(191) NULL,
    `startsAt` DATETIME(3) NULL,
    `sets` JSON NULL,
    `winnerPairId` VARCHAR(191) NULL,
    `nextMatchId` VARCHAR(191) NULL,
    `nextSlot` VARCHAR(1) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionMatch_clubId_idx`(`clubId`),
    INDEX `CompetitionMatch_competitionId_idx`(`competitionId`),
    INDEX `CompetitionMatch_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Slot_competitionId_idx` ON `Slot`(`competitionId`);

-- AddForeignKey
ALTER TABLE `Slot` ADD CONSTRAINT `Slot_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Competition` ADD CONSTRAINT `Competition_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Competition` ADD CONSTRAINT `Competition_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionSession` ADD CONSTRAINT `CompetitionSession_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionSession` ADD CONSTRAINT `CompetitionSession_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCourt` ADD CONSTRAINT `CompetitionCourt_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCourt` ADD CONSTRAINT `CompetitionCourt_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCourt` ADD CONSTRAINT `CompetitionCourt_courtId_fkey` FOREIGN KEY (`courtId`) REFERENCES `Court`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCategory` ADD CONSTRAINT `CompetitionCategory_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCategory` ADD CONSTRAINT `CompetitionCategory_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionGroup` ADD CONSTRAINT `CompetitionGroup_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionGroup` ADD CONSTRAINT `CompetitionGroup_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionGroup` ADD CONSTRAINT `CompetitionGroup_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `CompetitionCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPair` ADD CONSTRAINT `CompetitionPair_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPair` ADD CONSTRAINT `CompetitionPair_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPair` ADD CONSTRAINT `CompetitionPair_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `CompetitionCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPair` ADD CONSTRAINT `CompetitionPair_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `CompetitionGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPlayer` ADD CONSTRAINT `CompetitionPlayer_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPlayer` ADD CONSTRAINT `CompetitionPlayer_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPlayer` ADD CONSTRAINT `CompetitionPlayer_pairId_fkey` FOREIGN KEY (`pairId`) REFERENCES `CompetitionPair`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPlayer` ADD CONSTRAINT `CompetitionPlayer_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `Player`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `CompetitionCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `CompetitionGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_pairAId_fkey` FOREIGN KEY (`pairAId`) REFERENCES `CompetitionPair`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_pairBId_fkey` FOREIGN KEY (`pairBId`) REFERENCES `CompetitionPair`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_courtId_fkey` FOREIGN KEY (`courtId`) REFERENCES `Court`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_winnerPairId_fkey` FOREIGN KEY (`winnerPairId`) REFERENCES `CompetitionPair`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionMatch` ADD CONSTRAINT `CompetitionMatch_nextMatchId_fkey` FOREIGN KEY (`nextMatchId`) REFERENCES `CompetitionMatch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
