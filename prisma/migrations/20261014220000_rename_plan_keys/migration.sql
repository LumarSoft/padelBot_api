-- The landing sells three plans: Saque, Bandeja and Smash. The old informational keys map onto
-- them ("base" was the entry plan, the sales demo ran on "pro"). Any other value is left as it
-- is: the API reads an unknown key as "no restriction" and the ops console flags it.

-- AlterTable
ALTER TABLE `Club` MODIFY `plan` VARCHAR(191) NOT NULL DEFAULT 'saque';

UPDATE `Club` SET `plan` = 'saque' WHERE `plan` = 'base';
UPDATE `Club` SET `plan` = 'bandeja' WHERE `plan` = 'pro';
