-- Bandeja and Smash include modules Saque doesn't (fijo confirmation, kiosk stock, waitlist,
-- split payment, scheduled price rises). The API now refuses turning them ON on a plan without
-- them. Every club that exists before this migration keeps all of them — the old "base" plan
-- had everything, and nobody should lose a feature silently. Ops clears the flag from the
-- console once a plan is agreed with the club. New clubs start without it.

-- AlterTable
ALTER TABLE `Club` ADD COLUMN `grandfatheredFeatures` BOOLEAN NOT NULL DEFAULT false;

UPDATE `Club` SET `grandfatheredFeatures` = true;
