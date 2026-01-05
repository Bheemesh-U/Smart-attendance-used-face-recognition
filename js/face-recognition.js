/**
 * Face Recognition System using face-api.js
 * Integrated with Smart Attendance System
 */

// Load models from CDN
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

export const faceRecognition = {
    modelsLoaded: false,
    labeledFaceDescriptors: [],

    async loadModels() {
        if (this.modelsLoaded) return;
        console.log('Loading face-api models...');
        try {
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
            ]);
            this.modelsLoaded = true;
            console.log('Models loaded successfully');
        } catch (error) {
            console.error('Error loading face-api models:', error);
        }
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
        if (!this.modelsLoaded) await this.loadModels();

        console.log('Capturing facial descriptor for registration...');
        const detection = await faceapi.detectSingleFace(videoElement)
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

        const detections = await faceapi.detectAllFaces(videoElement)
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

        // Find matches with improved threshold (0.5 = more lenient, better for real-world conditions)
        const faceMatcher = new faceapi.FaceMatcher(this.labeledFaceDescriptors, 0.5);

        const results = resizedDetections.map(d => {
            return {
                detection: d,
                match: faceMatcher.findBestMatch(d.descriptor)
            };
        });

        results.forEach(result => {
            const { detection, match } = result;
            const label = match.toString();

            // Draw green box/circle on face
            const isUnknown = label.includes('unknown');
            const drawOptions = {
                label: isUnknown ? 'Scanning...' : studentDatabase.find(s => s.registration_no === match.label)?.name || match.label,
                boxColor: isUnknown ? '#f59e0b' : '#10b981', // Amber 500 (Scanning) vs Emerald 500 (Success)
                lineWidth: 2
            };

            const drawBox = new faceapi.draw.DrawBox(detection.detection.box, drawOptions);
            drawBox.draw(canvasElement);

            // If match found and confidence high, trigger attendance
            if (!label.includes('unknown')) {
                const student = studentDatabase.find(s => s.registration_no === match.label);
                if (student) {
                    window.dispatchEvent(new CustomEvent('faceRecognized', { detail: { student, confidence: match.distance } }));
                }
            }
        });

        return results.length; // Return number of faces detected
    }
};
