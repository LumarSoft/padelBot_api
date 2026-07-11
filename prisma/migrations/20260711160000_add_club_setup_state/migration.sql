-- AlterTable
ALTER TABLE `Club` ADD COLUMN `setupCompletedAt` DATETIME(3) NULL,
    ADD COLUMN `setupProgress` JSON NULL;

-- Clubs that already exist were provisioned by hand and are operating: don't send
-- their owners through the setup wizard. Only clubs created from now on start pending.
UPDATE `Club` SET `setupCompletedAt` = CURRENT_TIMESTAMP(3);
