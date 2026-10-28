CREATE TABLE `ijazah_records` (
	`id` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`bookId` varchar(36) NOT NULL,
	`payload` longtext NOT NULL,
	`deleted` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ijazah_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ijazah_records_owner_book_idx` ON `ijazah_records` (`ownerId`,`bookId`);--> statement-breakpoint
CREATE INDEX `ijazah_records_owner_updated_idx` ON `ijazah_records` (`ownerId`,`updatedAt`);