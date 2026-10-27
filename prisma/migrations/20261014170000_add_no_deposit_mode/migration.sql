-- AlterTable: a third payment policy — NONE = the bot books and confirms on the spot, no seña.
ALTER TABLE `Club` MODIFY `depositMode` ENUM('DEPOSIT', 'FULL', 'NONE') NOT NULL DEFAULT 'DEPOSIT';
