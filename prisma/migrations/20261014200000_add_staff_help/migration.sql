-- In-context help for new desk staff (no courses: taught on the real screen, at the moment).
--
-- Receptionists rotate every 1–3 months and don't read manuals. The panel gets a "Tu primer
-- día" checklist ticked from what each user really did, a "?" help with on-screen guides, and
-- the club's own "reglas de la casa".

-- AlterTable: the club's own desk Q&As for its staff (same shape as botFaq).
ALTER TABLE `Club` ADD COLUMN `houseRules` JSON NULL;

-- AlterTable: the user closed the "Tu primer día" card.
ALTER TABLE `User` ADD COLUMN `firstDayDismissedAt` DATETIME(3) NULL;

-- CreateTable: first time each user did a desk action that leaves no per-user trace otherwise.
CREATE TABLE `UserFirstAction` (
    `userId` INTEGER NOT NULL,
    `action` ENUM('RESCHEDULE', 'CONSUMPTION', 'DESK_PAYMENT', 'DEPOSIT_CONFIRMATION') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `action`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: help searches that found nothing, per club and normalized query (ops reads them).
CREATE TABLE `HelpSearchMiss` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `query` VARCHAR(80) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `HelpSearchMiss_updatedAt_idx`(`updatedAt`),
    UNIQUE INDEX `HelpSearchMiss_clubId_query_key`(`clubId`, `query`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserFirstAction` ADD CONSTRAINT `UserFirstAction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HelpSearchMiss` ADD CONSTRAINT `HelpSearchMiss_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
