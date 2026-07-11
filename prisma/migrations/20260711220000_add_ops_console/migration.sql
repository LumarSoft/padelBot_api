-- Ops console (`/ops`): a platform admin identity of our own, the sales file on each
-- lead, and the per-club OpenAI cost that until now only lived in process memory.

-- AlterTable: last panel login. A club that pays but stopped opening the panel is churning
-- before it cancels; nothing recorded that until now.
ALTER TABLE `User` ADD COLUMN `lastLoginAt` DATETIME(3) NULL;

-- AlterTable: turn ClubSignupRequest into an actual pipeline instead of a write-only inbox.
ALTER TABLE `ClubSignupRequest`
    ADD COLUMN `internalNotes` TEXT NULL,
    ADD COLUMN `contactedAt` DATETIME(3) NULL,
    ADD COLUMN `convertedClubId` VARCHAR(191) NULL;

CREATE INDEX `ClubSignupRequest_createdAt_idx` ON `ClubSignupRequest`(`createdAt`);

-- CreateTable: Lumarsoft operators. Separate from `User` on purpose — `User` is
-- tenant-scoped, and a platform admin must not belong to a club.
CREATE TABLE `PlatformAdmin` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlatformAdmin_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: daily OpenAI cost per club (the only real variable cost per tenant).
CREATE TABLE `LlmUsageDaily` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(191) NOT NULL,
    `calls` INTEGER NOT NULL DEFAULT 0,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `costMicroUsd` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LlmUsageDaily_clubId_dateKey_key`(`clubId`, `dateKey`),
    INDEX `LlmUsageDaily_clubId_idx`(`clubId`),
    INDEX `LlmUsageDaily_dateKey_idx`(`dateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LlmUsageDaily` ADD CONSTRAINT `LlmUsageDaily_clubId_fkey`
    FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
