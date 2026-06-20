/*
  Warnings:

  - Added the required column `clubId` to the `User` table without a default value. This is not possible if the table is not empty.
  - Made the column `name` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `User` ADD COLUMN `clubId` VARCHAR(191) NOT NULL,
    ADD COLUMN `role` ENUM('OWNER', 'STAFF') NOT NULL DEFAULT 'STAFF',
    MODIFY `name` VARCHAR(191) NOT NULL;

-- CreateTable
CREATE TABLE `Club` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Club_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `User_clubId_idx` ON `User`(`clubId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
