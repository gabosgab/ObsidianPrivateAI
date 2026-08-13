const assert = require('assert');

// We are going to mock RAGService behavior to show execution time differences.
class MockVectorDB {
    constructor() {
        this.docs = {};
    }
    getFileDocuments(path) {
        return this.docs[path] || [];
    }
    setFileDocuments(path, docs) {
        this.docs[path] = docs;
    }
}

class MockImageTextExtractor {
    async extractTextFromImage(file) {
        // Simulate an expensive API call to an LLM for image extraction (e.g., 200ms)
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true, extractedText: "Mocked text from " + file.path };
    }
}

class MockRAGService {
    constructor() {
        this.vectorDB = new MockVectorDB();
        this.imageTextExtractor = new MockImageTextExtractor();
        this.indexingAbortController = { signal: { aborted: false } };
    }

    async calculateCRC32(file) {
        return file.checksum;
    }

    async processImagesManuallyWithoutCache(imageFiles) {
        let processed = 0;
        for (let i = 0; i < imageFiles.length; i++) {
            const imageFile = imageFiles[i];

            // Extract text from image (Expensive)
            const result = await this.imageTextExtractor.extractTextFromImage(imageFile);

            if (result.success) {
                const checksum = await this.calculateCRC32(imageFile);
                this.vectorDB.setFileDocuments(imageFile.path, [{
                    metadata: { fileChecksum: checksum }
                }]);
                processed++;
            }
        }
        return processed;
    }

    async processImagesManuallyWithCache(imageFiles) {
        let processed = 0;
        let skipped = 0;
        for (let i = 0; i < imageFiles.length; i++) {
            const imageFile = imageFiles[i];

            const newImageChecksum = await this.calculateCRC32(imageFile);
            const existingImageDocs = this.vectorDB.getFileDocuments(imageFile.path);

            if (existingImageDocs.length > 0) {
                const existingChecksum = existingImageDocs[0].metadata.fileChecksum;
                if (existingChecksum === newImageChecksum) {
                    skipped++;
                    continue; // Skip extraction
                }
            }

            // Extract text from image (Expensive)
            const result = await this.imageTextExtractor.extractTextFromImage(imageFile);

            if (result.success) {
                const checksum = newImageChecksum;
                this.vectorDB.setFileDocuments(imageFile.path, [{
                    metadata: { fileChecksum: checksum }
                }]);
                processed++;
            }
        }
        return { processed, skipped };
    }
}

async function runBenchmark() {
    console.log("=== Benchmarking processImagesManually ===");

    // Create 10 mock image files
    const imageFiles = Array.from({length: 10}, (_, i) => ({
        path: `image_${i}.png`,
        checksum: `abc_${i}`
    }));

    const ragServiceUncached = new MockRAGService();
    // Pre-populate DB so it simulates the "already indexed" state
    for (const file of imageFiles) {
        ragServiceUncached.vectorDB.setFileDocuments(file.path, [{ metadata: { fileChecksum: file.checksum } }]);
    }

    console.log("Running WITHOUT caching...");
    const startUncached = Date.now();
    await ragServiceUncached.processImagesManuallyWithoutCache(imageFiles);
    const endUncached = Date.now();
    console.log(`Time taken without caching: ${endUncached - startUncached}ms`);


    const ragServiceCached = new MockRAGService();
    // Pre-populate DB so it simulates the "already indexed" state
    for (const file of imageFiles) {
        ragServiceCached.vectorDB.setFileDocuments(file.path, [{ metadata: { fileChecksum: file.checksum } }]);
    }

    console.log("\nRunning WITH caching...");
    const startCached = Date.now();
    await ragServiceCached.processImagesManuallyWithCache(imageFiles);
    const endCached = Date.now();
    console.log(`Time taken with caching: ${endCached - startCached}ms`);

    console.log(`\nImprovement: ${endUncached - startUncached - (endCached - startCached)}ms (Skipped 10 expensive LLM calls)`);
}

runBenchmark().catch(console.error);
