#!/usr/bin/env bun
import path from "node:path";
import glob from "fast-glob";
import fs from "fs-extra";
import pc from "picocolors";
import prompts from "prompts";
import sharp from "sharp";

interface Config {
	input: string;
	output: string;
	blacklists: string[];
	file_size?: "small" | "smallest";
	preferred_type?: "png" | "jpeg" | "jpg" | "webp";
	working_directory?: string;
}

const CONFIG_FILE_NAME = "rlcp.config.json";
const LOCK_FILE_NAME = "rlcp.lock";

interface LockData {
	conversions: Record<string, string>;
}

async function loadLockFile(): Promise<LockData> {
	const lockPath = path.join(process.cwd(), LOCK_FILE_NAME);
	if (await fs.pathExists(lockPath)) {
		try {
			return await fs.readJSON(lockPath);
		} catch (error) {
			console.error(pc.red("Error reading lock file:"), error);
		}
	}
	return { conversions: {} };
}

async function saveLockFile(data: LockData) {
	const lockPath = path.join(process.cwd(), LOCK_FILE_NAME);
	try {
		await fs.writeJSON(lockPath, data, { spaces: 2 });
	} catch (error) {
		console.error(pc.red("Error writing lock file:"), error);
	}
}

async function loadConfig(): Promise<Config> {
	const configPath = path.join(process.cwd(), CONFIG_FILE_NAME);
	if (!(await fs.pathExists(configPath))) {
		console.error(
			pc.red(`Error: Configuration file ${CONFIG_FILE_NAME} not found.`),
		);
		process.exit(1);
	}

	try {
		const config = (await fs.readJSON(configPath)) as Config;
		// Basic validation
		if (!config.input || !config.output) {
			console.error(
				pc.red('Error: Config must have "input" and "output" properties.'),
			);
			process.exit(1);
		}

		// Validate file_size if present
		if (config.file_size && !["small", "smallest"].includes(config.file_size)) {
			console.error(
				pc.red(
					`Error: Invalid file_size "${config.file_size}". Accepted values: small, smallest`,
				),
			);
			process.exit(1);
		}

		// Validate preferred_type if present
		if (
			config.preferred_type &&
			!["png", "jpeg", "jpg", "webp"].includes(config.preferred_type)
		) {
			console.error(
				pc.red(
					`Error: Invalid preferred_type "${config.preferred_type}". Accepted values: png, jpeg, jpg, webp`,
				),
			);
			process.exit(1);
		}

		return config;
	} catch (error) {
		console.error(pc.red("Error reading configuration file:"), error);
		process.exit(1);
	}
}

async function ensureGitIgnore(outputDir: string) {
	const gitIgnorePath = path.join(process.cwd(), ".gitignore");

	try {
		let content = "";
		if (await fs.pathExists(gitIgnorePath)) {
			content = await fs.readFile(gitIgnorePath, "utf-8");
		}

		// Check if outputDir is already ignored
		const lines = content.split("\n").map((l) => l.trim());
		const isIgnored = lines.some(
			(line) =>
				line === outputDir ||
				line === `/${outputDir}` ||
				line === `${outputDir}/` ||
				line === `/${outputDir}/`,
		);

		if (!isIgnored) {
			console.log(pc.yellow(`Adding "${outputDir}" to .gitignore...`));
			const newContent =
				content.endsWith("\n") || content === ""
					? `${content}${outputDir}\n`
					: `${content}\n${outputDir}\n`;

			await fs.writeFile(gitIgnorePath, newContent);
		}
	} catch (error) {
		console.error(pc.red("Error checking/updating .gitignore:"), error);
	}
}

function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function updateReferences(
	workingDir: string,
	replacements: { oldRel: string; newRel: string }[],
) {
	console.log(pc.dim(`\nUpdating references in ${workingDir}...`));

	// Sort replacements by length of oldRel descending to avoid partial matches
	replacements.sort((a, b) => b.oldRel.length - a.oldRel.length);

	// Find files to update
	const files = await glob("**/*.{html,js,jsx,ts,tsx,css,scss,json,md}", {
		cwd: workingDir,
		absolute: true,
		ignore: ["**/node_modules/**", ".git/**", "**/dist/**", "**/build/**"],
	});

	let updatedFilesCount = 0;

	for (const filePath of files) {
		try {
			let content = await fs.readFile(filePath, "utf-8");
			let hasChanges = false;

			for (const { oldRel, newRel } of replacements) {
				// Escape the old path for regex
				const escapedOld = escapeRegExp(oldRel);

				// Regex to match the path but ensure it's not a suffix of a longer path
				// We look for the string NOT preceded by a word char, dot, hyphen, OR a slash preceded by those.
				const regex = new RegExp(
					`(?<![\\w\\-.])(?<![\\w\\-.]\\/)${escapedOld}`,
					"g",
				);

				if (regex.test(content)) {
					content = content.replace(regex, newRel);
					hasChanges = true;
				}
			}

			if (hasChanges) {
				await fs.writeFile(filePath, content, "utf-8");
				console.log(
					pc.blue(
						`  Updated references in: ${path.relative(process.cwd(), filePath)}`,
					),
				);
				updatedFilesCount++;
			}
		} catch (error) {
			console.error(pc.red(`Error updating file ${filePath}:`), error);
		}
	}

	console.log(pc.green(`Updated references in ${updatedFilesCount} files.`));
}

async function main() {
	console.log(
		pc.cyan("Welcome to Reduce Largest Contentful Paint (RLCP)! 🖼️\n"),
	);

	const config = await loadConfig();
	const lockData = await loadLockFile();
	// Create a set of target files to easily check if a file is a result of a previous conversion
	const lockValues = new Set(Object.values(lockData.conversions));

	const inputDir = config.input;
	const outputDir = config.output;
	const blacklists = config.blacklists || [];

	await ensureGitIgnore(outputDir);

	// Ensure input directory exists
	if (!(await fs.pathExists(inputDir))) {
		console.error(
			pc.red(`Error: Input directory "${inputDir}" does not exist.`),
		);
		process.exit(1);
	}

	// Find images
	const pattern = path.join(inputDir, "**/*.{png,jpg,jpeg,webp}");
	const ignore = blacklists.map((p) => p); // fast-glob handles patterns directly

	console.log(pc.dim(`Scanning for images in ${inputDir}...`));

	const files = await glob(pattern, {
		ignore: ignore,
		absolute: false, // We want relative paths to handle moving correctly
		cwd: process.cwd(),
	});

	if (files.length === 0) {
		console.log(pc.yellow("No images found matching the criteria."));
		return;
	}

	console.log(pc.green(`Found ${files.length} images.`));

	// Determine settings
	let targetFormat = config.preferred_type;
	let qualitySetting = config.file_size;
	let workingDir = config.working_directory;

	const questions: prompts.PromptObject[] = [];

	if (!targetFormat) {
		questions.push({
			type: "select",
			name: "format",
			message: "What format do you want to convert the images to?",
			choices: [
				{ title: "PNG (Fairly large, supports transparency)", value: "png" },
				{ title: "JPEG (Small, doesn't have transparency)", value: "jpeg" },
				{ title: "JPG (Small, doesn't have transparency)", value: "jpg" },
				{ title: "WEBP (Smallest file Size, has transparency)", value: "webp" },
			],
			initial: 3,
		});
	}

	if (!qualitySetting) {
		questions.push({
			type: "select",
			name: "quality",
			message: "What quality do you want the images to be reduced to?",
			choices: [
				{ title: "Small (80% quality)", value: "small" },
				{ title: "Smallest (60% quality)", value: "smallest" },
			],
			initial: 0,
		});
	}

	if (!workingDir) {
		questions.push({
			type: "text",
			name: "working_directory",
			message: "What is the working directory for updating references?",
			initial: "./",
		});
	}

	if (questions.length > 0) {
		const response = await prompts(questions);

		// Check if operation was cancelled (missing required answers)
		if (
			(!targetFormat && !response.format) ||
			(!qualitySetting && !response.quality) ||
			(!config.working_directory && response.working_directory === undefined)
		) {
			console.log(pc.yellow("Operation cancelled."));
			return;
		}

		if (!targetFormat) targetFormat = response.format;
		if (!qualitySetting) qualitySetting = response.quality;
		if (!workingDir) workingDir = response.working_directory;
	}

	let qualityValue = 80;
	if (qualitySetting === "smallest") {
		qualityValue = 60;
	}

	console.log(
		pc.blue(
			`\nConverting images in ${inputDir} to ${targetFormat} with ${qualitySetting} quality...\n`,
		),
	);

	let successCount = 0;
	let failCount = 0;
	const replacements: { oldRel: string; newRel: string }[] = [];

	// Helper to add replacement
	const addReplacement = (
		originalFile: string,
		targetFile: string,
		inputDir: string,
	) => {
		const oldRel = path.relative(inputDir, originalFile);
		const newRel = path.relative(
			path.resolve(process.cwd(), inputDir),
			targetFile,
		);
		replacements.push({ oldRel, newRel });

		// Also add path relative to CWD if it's different
		if (originalFile !== oldRel) {
			const oldCwd = originalFile;
			const newCwd = path.relative(process.cwd(), targetFile);
			replacements.push({ oldRel: oldCwd, newRel: newCwd });
		}
	};

	for (const file of files) {
		try {
			const absoluteFilePath = path.resolve(process.cwd(), file);
			const fileDir = path.dirname(file);
			const fileName = path.basename(file, path.extname(file));

			// Determine output path for the original file
			// We want to preserve the structure inside the output directory
			// If file is "public/images/foo.png" and output is "temp_public"
			// We move it to "temp_public/images/foo.png"
			const relativePath = path.relative(inputDir, file); // This is relative to inputDir e.g. "sub/image.png"
			const originalFileDest = path.join(outputDir, relativePath);

			const finalNewPath = path.resolve(
				process.cwd(),
				fileDir,
				targetFormat === "jpg"
					? `${fileName}.jpg`
					: `${fileName}.${targetFormat}`,
			);

			// Check lock file first
			if (lockData.conversions[file]) {
				const lockedTargetRel = lockData.conversions[file];
				const lockedTargetAbs = path.resolve(process.cwd(), lockedTargetRel);

				if (await fs.pathExists(lockedTargetAbs)) {
					console.log(pc.yellow(`⚠ Skipping: ${file} (Already converted)`));
					addReplacement(file, lockedTargetAbs, inputDir);
					continue;
				}
			}

			// Check if file is a generated file (result of a previous conversion)
			if (lockValues.has(file)) {
				console.log(pc.yellow(`⚠ Skipping: ${file} (Generated file)`));
				continue;
			}

			if (await fs.pathExists(originalFileDest)) {
				if (await fs.pathExists(finalNewPath)) {
					console.log(pc.yellow(`⚠ Skipping: ${file} (Backup exists)`));
					// Even if skipped, we should add it to replacements so references are updated
					addReplacement(file, finalNewPath, inputDir);
					// Update lock file if missing
					lockData.conversions[file] = path.relative(
						process.cwd(),
						finalNewPath,
					);
					continue;
				}
			}

			// 1. Convert and save new image
			const sharpInstance = sharp(absoluteFilePath);

			if (targetFormat === "png") {
				await sharpInstance
					.png({ quality: qualityValue })
					.toFile(`${absoluteFilePath}.temp`);
			} else if (targetFormat === "jpeg" || targetFormat === "jpg") {
				await sharpInstance
					.jpeg({ quality: qualityValue })
					.toFile(`${absoluteFilePath}.temp`);
			} else if (targetFormat === "webp") {
				await sharpInstance
					.webp({ quality: qualityValue })
					.toFile(`${absoluteFilePath}.temp`);
			}

			// 2. Move original file to output directory
			await fs.move(absoluteFilePath, originalFileDest, { overwrite: true });

			// 3. Rename temp new file to final name
			await fs.move(`${absoluteFilePath}.temp`, finalNewPath, {
				overwrite: true,
			});

			addReplacement(file, finalNewPath, inputDir);
			lockData.conversions[file] = path.relative(process.cwd(), finalNewPath);

			console.log(pc.green(`✔ Processed: ${file}`));
			successCount++;
		} catch (err) {
			console.error(pc.red(`✘ Failed: ${file}`), err);
			failCount++;
		}
	}

	// Also scan output directory for previously converted files
	// This handles the case where the source file is no longer in inputDir
	// We can now use the lock file for this as well!

	// Let's clear replacements and rebuild from lockData to be sure we cover everything
	// including files that were just converted and files converted in the past.
	replacements.length = 0;
	for (const [originalRelPath, targetRelPath] of Object.entries(
		lockData.conversions,
	)) {
		// Ensure it belongs to current inputDir to avoid issues if config changes
		// (Though if config changes, lock file might be invalid/stale for those entries)
		// We'll assume lock file entries are valid.

		const targetAbsPath = path.resolve(process.cwd(), targetRelPath);
		addReplacement(originalRelPath, targetAbsPath, inputDir);
	}

	await saveLockFile(lockData);

	console.log(
		pc.bold(
			`\nDone! Successfully processed ${successCount} images. Failed: ${failCount}.`,
		),
	);

	if (workingDir && replacements.length > 0) {
		if (await fs.pathExists(workingDir)) {
			await updateReferences(workingDir, replacements);
		} else {
			console.warn(
				pc.yellow(
					`Working directory "${workingDir}" does not exist. Skipping reference updates.`,
				),
			);
		}
	}
}

main().catch((err) => {
	console.error(pc.red("Unexpected error:"), err);
});
