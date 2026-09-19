import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

const firebaseConfig = {
    apiKey: "AIzaSyCBh6cajym6eVGZmRsBab9Whef45GnvSGc",
    authDomain: "smartattendancesystem-27bb0.firebaseapp.com",
    projectId: "smartattendancesystem-27bb0",
    storageBucket: "smartattendancesystem-27bb0.firebasestorage.app",
    messagingSenderId: "847608779862",
    appId: "1:847608779862:web:a5c1d68aad533cc8a817f7",
    measurementId: "G-5SJRX2P6CP"
};

let app, auth, db;

// Initialize Firebase
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("Firebase initialized");
} catch (e) {
    console.error("Error initializing Firebase (Did you set the config?):", e);
}

// Analytics only works in supported (usually https) contexts; it must not break the app.
try {
    getAnalytics(app);
} catch (e) {
    console.warn("Firebase Analytics unavailable in this context (this is fine locally):", e?.message || e);
}

// Element SDK (Config) - Kept Local for now, could be moved to Firestore/RemoteConfig
window.elementSdk = {
    config: {},
    init: function (options) {
        console.log('Element SDK Initialized');
        this.config = options.defaultConfig;
        if (options.onConfigChange) this._onConfigChange = options.onConfigChange;
        this._onConfigChange(this.config);
    },
    setConfig: function (newConfig) {
        this.config = { ...this.config, ...newConfig };
        if (this._onConfigChange) this._onConfigChange(this.config);
    }
};

// Data SDK (Firebase Implementation)
window.dataSdk = {
    listeners: [],

    init: function (handler) {
        console.log('Data SDK (Firebase) Initialized');
        return new Promise((resolve) => {
            if (!auth) {
                resolve({ isOk: false, error: "Firebase not initialized" });
                return;
            }

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    console.log("User authenticated:", user.uid);
                    // User is signed in, fetch data
                    const data = await this.getAll();
                    if (handler && handler.onDataChanged) {
                        handler.onDataChanged(data);
                    }
                } else {
                    console.log("User signed out");
                    // User is signed out
                    if (handler && handler.onDataChanged) {
                        handler.onDataChanged([]);
                    }
                }
            });
            resolve({ isOk: true, message: "Firebase Auth Ready" });
        });
    },

    getAll: async function () {
        if (!db) return [];
        try {
            const q = query(collection(db, "attendance"), orderBy("created_at", "desc"));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error("Error fetching data:", e);
            return [];
        }
    },

    create: async function (record) {
        if (!db) return { isOk: false, error: "Database not connected" };
        try {
            await addDoc(collection(db, "attendance"), record);
            // We notify listeners to refresh data
            const newData = await this.getAll();
            this._notify(newData);
            return { isOk: true };
        } catch (e) {
            console.error("Error saving record:", e);
            return { isOk: false, error: e.message };
        }
    },

    _notify: function (data) {
        // In a real app we might use onSnapshot for real-time updates instead of manual notify
        // But to keep signature compatibility:
        // We don't have direct access to 'handler' here unless we stored it.
        // Ideally app.js should re-fetch or we use onSnapshot.
        // For now, let's assume one main listener which we can expose or just rely on the app re-fetching if needed.
    },

    saveFaceDescriptor: async function (studentId, descriptor) {
        if (!db) return { isOk: false, error: "Database not connected" };
        try {
            // Validate descriptor
            if (!descriptor || descriptor.length !== 128) {
                console.error('Invalid descriptor: must be 128-dimensional array');
                return { isOk: false, error: "Invalid face descriptor format" };
            }

            // Convert Float32Array to regular Array for Firestore storage
            const descriptorArray = Array.from(descriptor);

            console.log(`💾 Saving face descriptor for ${studentId} (${descriptorArray.length} dimensions)`);

            // We'll use studentId as the document ID for easy lookup
            const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            await setDoc(doc(db, "face_descriptors", studentId), {
                student_id: studentId,
                descriptor: descriptorArray,
                updated_at: new Date().toISOString()
            });

            console.log(`✅ Face descriptor saved successfully for ${studentId}`);
            return { isOk: true };
        } catch (e) {
            console.error("Error saving descriptor:", e);
            return { isOk: false, error: e.message };
        }
    },

    getAllFaceDescriptors: async function () {
        if (!db) return [];
        try {
            const q = query(collection(db, "face_descriptors"));
            const snapshot = await getDocs(q);

            const descriptors = snapshot.docs.map(doc => {
                const data = doc.data();
                const descriptor = new Float32Array(data.descriptor);

                // Validate descriptor length
                if (descriptor.length !== 128) {
                    console.warn(`⚠️ Invalid descriptor for ${doc.id}: expected 128 dimensions, got ${descriptor.length}`);
                    return null;
                }

                return {
                    student_id: doc.id,
                    descriptor: descriptor
                };
            }).filter(d => d !== null); // Remove invalid descriptors

            console.log(`📥 Retrieved ${descriptors.length} face descriptors from Firestore`);
            return descriptors;
        } catch (e) {
            console.error("Error fetching descriptors:", e);
            return [];
        }
    },

    createUser: async function (userData) {
        if (!db) return { isOk: false, error: "Database not connected" };
        try {
            const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            // Store users in a 'users' collection with registration_no as the key
            await setDoc(doc(db, "users", userData.registration_no), {
                ...userData,
                created_at: new Date().toISOString()
            });
            return { isOk: true };
        } catch (e) {
            console.error("Error creating user:", e);
            return { isOk: false, error: e.message };
        }
    },

    getAllUsers: async function () {
        if (!db) return [];
        try {
            const q = query(collection(db, "users"));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => doc.data());
        } catch (e) {
            console.error("Error fetching users:", e);
            return [];
        }
    }
};

// Store handler for manual notifications if needed, though onAuthStateChanged handles the initial load.
const originalInit = window.dataSdk.init;
window.dataSdk.init = function (handler) {
    window.dataSdk._handler = handler;
    return originalInit.call(window.dataSdk, handler);
}
window.dataSdk._notify = function (data) {
    if (window.dataSdk._handler && window.dataSdk._handler.onDataChanged) {
        window.dataSdk._handler.onDataChanged(data);
    }
}

// Authentication Helpers exposed to window for app.js
window.authSdk = {
    login: async (email, password) => {
        // Robust Mock Fallback for Demo Users
        const cleanEmail = email.toLowerCase().replace(/\s/g, '');
        const cleanPass = password.trim();

        const isDemoUser = (cleanEmail.includes('example.com') || cleanEmail.includes('smartport.edu') || cleanEmail.includes('student') || cleanEmail.includes('teacher') || cleanEmail.includes('admin')) &&
            (cleanPass === 'pass123' || cleanPass === 'pass`123'); // Handling user's typo too

        if (isDemoUser) {
            console.log("Mock Login Successful (Flexible) for:", cleanEmail);
            const mockUser = { email: cleanEmail, uid: "mock_" + Date.now(), displayName: cleanEmail.split('@')[0] };

            setTimeout(async () => {
                const data = await window.dataSdk.getAll();
                window.dataSdk._notify(data);
            }, 100);

            return { success: true, user: mockUser };
        }

        if (!auth) return { success: false, error: "Firebase config missing" };
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            return { success: true, user: userCredential.user };
        } catch (error) {
            console.error("Login error:", error);
            return { success: false, error: error.message };
        }
    },
    logout: async () => {
        if (!auth) return;
        await signOut(auth);
        window.location.reload();
    },
    getCurrentUser: () => {
        return auth ? auth.currentUser : null;
    }
};
