-- The owner can close the "te quedan pocos créditos" notice: it stays closed for that month and
-- comes back once when the credits run out. Per user, not per browser: owners use several devices.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `creditsNoticeDismissed` VARCHAR(16) NULL;
