/**
 * Face Recognition System using face-api.js
 * Integrated with Smart Attendance System
 */

// Load models from CDN (must match the dist build loaded in index.html: @vladmandic/face-api)
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

// Detection tuning:
// - inputSize 416/512/320 are the valid TinyFaceDetector sizes; 608 is not a valid option.
//   (ssdMobilenetv1 ignores inputSize and minConfidence, but the values are harmless.)
// - scoreThreshold 0.4 (was effectively ~0.5 default): fewer missed faces at classroom distance.
const DETECTION_OPTIONS = { inputSize: 416, scoreThreshold: 0.4 };

// Euclidean distance below this = same person. face-api's default is 0.6 (many false
// positives in a class of people). 0.5 is a better real-world trade-off.
// Distance is NOT a percentage: recognition confidence % = (1 - distance) * 100.
const MATCH_THRESHOLD = 0.5;

export const faceRecognition = {
    modelsLoaded: false,
    labeledFaceDescriptors: [],
    _loadPromise: null,

    async loadModels() {
        if (this.modelsLoaded) return;
        // Reuse the in-flight load so parallel callers don't start a second download.
        if (this._loadPromise) return this._loadPromise;

        console.log('Loading face-api models...');
        this._loadPromise = (async () => {
            try {
                await Promise.all([
                    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
                ]);
                this.modelsLoaded = true;
                console.log('Models loaded successfully');
            } catch (error) {
                this._loadPromise = null; // allow retry on next call
                console.error('Error loading face-api models:', error);
                throw new Error('Could not load AI models. Check your internet connection and refresh.');
            }
        })();
        return this._loadPromise;
    },

    async initLabeledDescriptors(students) {
        console.log('Fetching student face descriptors from Cloud...');
        try {
            const savedDescriptors = await window.dataSdk.getAllFaceDescriptors();

            if (savedDescriptors.length === 0) {
                console.warn('⚠️ No face descriptors found in database. Students need to register their faces first.');
                this.labeledFaceDescriptors = [];
                return;
            }

            this.labeledFaceDescriptors = savedDescriptors.map(sd => {
                // Ensure descriptor is a Float32Array
                const descriptor = sd.descriptor instanceof Float32Array
                    ? sd.descriptor
                    : new Float32Array(sd.descriptor);

                console.log(`✓ Loaded descriptor for ${sd.student_id} (${descriptor.length} dimensions)`);
                return new faceapi.LabeledFaceDescriptors(sd.student_id, [descriptor]);
            });

            console.log(`✅ Successfully loaded ${this.labeledFaceDescriptors.length} face descriptors from cloud.`);
        } catch (error) {
            console.error('❌ Error loading face descriptors:', error);
            this.labeledFaceDescriptors = [];
        }
    },

    async captureDescriptor(videoElement) {
        await this.loadModels();

        console.log('Capturing facial descriptor for registration...');
        const detection = await faceapi.detectSingleFace(videoElement, DETECTION_OPTIONS)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) {
            return { success: false, error: 'No face detected. Please ensure you are well-lit and facing the camera.' };
        }

        return { success: true, descriptor: detection.descriptor };
    },

    async detectAndIdentify(videoElement, canvasElement, studentDatabase) {
        if (!this.modelsLoaded) await this.loadModels();

        const displaySize = { width: videoElement.videoWidth, height: videoElement.videoHeight };
        if (displaySize.width === 0) return 0; // Video not ready

        faceapi.matchDimensions(canvasElement, displaySize);

        const detections = await faceapi.detectAllFaces(videoElement, DETECTION_OPTIONS)
            .withFaceLandmarks()
            .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        // Clear canvas
        canvasElement.getContext('2d').clearRect(0, 0, canvasElement.width, canvasElement.height);

        // Check if we have any descriptors loaded
        if (this.labeledFaceDescriptors.length === 0) {
            console.warn('⚠️ No face descriptors loaded. Cannot perform recognition.');
            return 0;
        }

        // Find matches (see MATCH_THRESHOLD note above)
        const faceMatcher = new faceapi.FaceMatcher(this.labeledFaceDescriptors, MATCH_THRESHOLD);

        const results = resizedDetections.map(d => {
            return {
                detection: d,
                match: faceMatcher.findBestMatch(d.descriptor)
            };
        });

        results.forEach(result => {
            const { detection, match } = result;

            const isUnknown = match.label === 'unknown';
            // face-api returns a distance (lower = better). Convert to a confidence %.
            const confidencePct = Math.round((1 - match.distance) * 100);
            const student = studentDatabase.find(s => s.registration_no === match.label);

            // Video is CSS-mirrored (scaleX(-1)); mirror the box so it aligns with what is seen.
            const mirroredBox = {
                x: displaySize.width - detection.detection.box.x - detection.detection.box.width,
                y: detection.detection.box.y,
                width: detection.detection.box.width,
                height: detection.detection.box.height
            };

            const drawOptions = {
                label: isUnknown ? 'Scanning...' : `${student?.name || match.label} (${confidencePct}%)`,
                boxColor: isUnknown ? '#f59e0b' : '#10b981', // Amber 500 (Scanning) vs Emerald 500 (Success)
                lineWidth: 2
            };

            const drawBox = new faceapi.draw.DrawBox(mirroredBox, drawOptions);
            drawBox.draw(canvasElement);

            // Recognized student -> ask the app to mark attendance
            if (!isUnknown && student) {
                window.dispatchEvent(new CustomEvent('faceRecognized', { detail: { student, confidence: match.distance, confidencePct } }));
            }
        });

        return results.length; // Return number of faces detected
    }
};
