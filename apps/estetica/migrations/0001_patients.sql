CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`patient` text NOT NULL,
	`hash` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`patient`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_images_patient_hash` ON `images` (`patient`,`hash`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`manifest` text DEFAULT '{"visits":[]}' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_patients_owner_code` ON `patients` (`owner`,`code`);