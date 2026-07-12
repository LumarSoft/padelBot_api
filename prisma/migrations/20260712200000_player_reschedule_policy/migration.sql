-- Player-side reschedule policy.
--
-- A player who can't make it should MOVE their booking, not cancel it: the deposit stays
-- alive on the same booking, the old slot is freed for the waitlist to resell, and no money
-- leaves the club. That's why this can be self-service by default, while a real cancellation
-- (which does move money) remains a decision of the club, in the panel.

-- AlterTable: how much the player may do on their own, and the guard rails around it.
ALTER TABLE `Club`
    ADD COLUMN `playerReschedule` ENUM('SELF', 'REQUEST', 'OFF') NOT NULL DEFAULT 'SELF',
    -- Too close to the start, a freed court can't be resold → a human decides instead.
    ADD COLUMN `playerRescheduleCutoffHours` INTEGER NULL DEFAULT 6,
    -- Without a cap, a booking can be pushed forward forever — which is also how a player
    -- would dodge the deposit window.
    ADD COLUMN `maxPlayerReschedules` INTEGER NOT NULL DEFAULT 1;

-- AlterTable: how many times the PLAYER has moved this booking (admin moves don't count).
ALTER TABLE `Booking`
    ADD COLUMN `rescheduleCount` INTEGER NOT NULL DEFAULT 0;
