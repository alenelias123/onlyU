// This script is designed to run in the global scope.
// All application logic is encapsulated in the `App` object
// to avoid polluting the global namespace.

const App = {
    // ========================
    // CONFIG & STATE
    // ========================
    config: {
        firebase: {
            apiKey: "AIzaSyA5wXboSGvB4F36LWR2zrz7XUzWbx8USq0",
  authDomain: "chat-802b8.firebaseapp.com",
  projectId: "chat-802b8",
   databaseURL: "https://chat-802b8-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "chat-802b8.firebasestorage.app",
  messagingSenderId: "511403700067",
  appId: "1:511403700067:web:51e30ae1b5d25b7718ed56",
  measurementId: "G-7GHC8RPD0T"
        },
        modelsUrl: './models',
        matchThreshold: 0.55,
        faceapiOptions: new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }),
        registrationScanDuration: 3000, // 3 seconds
        registrationScanInterval: 500, // 0.5 seconds
    },
    
    state: {
        modelsLoaded: false,
        myIdentity: null, // { uuid, privateKey, faceMatcher }
        currentChatPartner: null, // { uuid, publicKey }
        sharedSecretCache: {},
        messageToDecrypt: null,
        videoStream: null,
        modalVideoStream: null,
        activeChatListener: null,
    },

    // ========================
    // DOM ELEMENT REFERENCES
    // ========================
    elements: {
        setupView: document.getElementById('setup-view'),
        chatView: document.getElementById('chat-view'),
        video: document.getElementById('video'),
        canvas: document.getElementById('canvas'),
        registerBtn: document.getElementById('register-btn'),
        registerInstructions: document.getElementById('register-instructions'),
        myUuidDisplay: document.getElementById('my-uuid'),
        logoutBtn: document.getElementById('logout-btn'),
        userList: document.getElementById('user-list'),
        manualUuidInput: document.getElementById('manual-uuid-input'), // New
        manualChatBtn: document.getElementById('manual-chat-btn'),     // New
        chatPartnerUuidDisplay: document.getElementById('chat-partner-uuid'),
        chatWindow: document.getElementById('chat-window'),
        messageInput: document.getElementById('message-input'),
        sendBtn: document.getElementById('send-btn'),
        statusMessage: document.getElementById('statusMessage'),
        decryptModal: document.getElementById('decrypt-modal'),
        modalVideo: document.getElementById('modalVideo'),
        modalCanvas: document.getElementById('modalCanvas'),
        verifyDecryptBtn: document.getElementById('verify-decrypt-btn'),
        cancelDecryptBtn: document.getElementById('cancel-decrypt-btn'),
    },

    // ========================
    // INITIALIZATION
    // ========================
    async init() {
        this.addEventListeners();
        firebase.initializeApp(this.config.firebase);
        this.db = firebase.database();
        
        await this.loadModels();
        this.state.myIdentity = await this.identity.loadFromStorage();

        if (this.state.myIdentity) {
            this.ui.showChatView();
            await this.faceLogin();
        } else {
            this.ui.showSetupView();
        }
    },
    
    async loadModels() {
        this.ui.updateStatus("Loading face models...", "bg-blue-500");
        try {
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(this.config.modelsUrl),
                faceapi.nets.faceLandmark68Net.loadFromUri(this.config.modelsUrl),
                faceapi.nets.faceRecognitionNet.loadFromUri(this.config.modelsUrl)
            ]);
            this.state.modelsLoaded = true;
            this.ui.updateStatus("Models loaded.", "bg-green-500", 2000);
        } catch (e) {
            this.ui.updateStatus("Failed to load models. Check console.", "bg-red-500");
            console.error("Model loading error:", e);
        }
    },

    // ========================
    // EVENT LISTENERS
    // ========================
    addEventListeners() {
        this.elements.registerBtn.addEventListener('click', () => this.register());
        this.elements.logoutBtn.addEventListener('click', () => this.identity.logout());
        this.elements.myUuidDisplay.addEventListener('click', () => this.ui.copyMyUuid());
        this.elements.sendBtn.addEventListener('click', () => this.chat.sendMessage());
        this.elements.manualChatBtn.addEventListener('click', () => this.chat.startManualChat()); // New
    },

    // ========================
    // UI MANAGEMENT
    // ========================
    ui: {
        showSetupView() {
            App.elements.setupView.classList.remove('hidden');
            App.elements.chatView.classList.add('hidden');
            App.video.start(App.elements.video, App.elements.canvas, 'videoStream')
               .then(() => App.elements.registerBtn.disabled = false);
        },

        showChatView() {
            App.elements.setupView.classList.add('hidden');
            App.elements.chatView.classList.remove('hidden');
            App.elements.myUuidDisplay.textContent = App.state.myIdentity.uuid;
            App.elements.userList.innerHTML = '<p class="text-gray-400 placeholder">Loading online users...</p>';
            App.chat.listenForUsers();
        },

        updateStatus(message, bgColor, duration = 0) {
            const el = App.elements.statusMessage;
            el.textContent = message;
            el.className = `visible ${bgColor}`;
            if (duration > 0) {
                setTimeout(() => {
                    el.classList.remove('visible');
                }, duration);
            }
        },

        copyMyUuid() {
            navigator.clipboard.writeText(App.state.myIdentity.uuid)
                .then(() => App.ui.updateStatus("UUID copied!", "bg-green-500", 2000))
                .catch(() => App.ui.updateStatus("Failed to copy.", "bg-red-500", 2000));
        },
    },

    // ========================
    // REGISTRATION & LOGIN
    // ========================
    async register() {
        this.elements.registerBtn.disabled = true;
        const descriptors = [];
        
        this.ui.updateStatus("Starting scan... Hold still.", "bg-blue-500");
        this.elements.registerInstructions.textContent = "Scanning... Please look at the camera.";

        const captureInterval = setInterval(async () => {
            const descriptor = await this.face.getDescriptor(this.elements.video);
            if (descriptor) {
                descriptors.push(descriptor);
                this.ui.updateStatus(`Collected sample ${descriptors.length}`, "bg-blue-500");
            }
        }, this.config.registrationScanInterval);

        setTimeout(async () => {
            clearInterval(captureInterval);
            
            if (descriptors.length < 3) {
                this.ui.updateStatus("Scan failed. Not enough face samples. Please try again.", "bg-red-500", 4000);
                this.elements.registerInstructions.textContent = "To begin, please register your face to create a secure identity.";
                this.elements.registerBtn.disabled = false;
                return;
            }

            this.ui.updateStatus("Scan complete. Creating your secure identity...", "bg-green-500");
            
            let uuid = localStorage.getItem('secure-chat-device-uuid');
            if (!uuid) {
                uuid = self.crypto.randomUUID();
                localStorage.setItem('secure-chat-device-uuid', uuid);
            }
            
            const keyPair = await this.crypto.generateECDHKeyPair();
            const jwkPublicKey = await self.crypto.subtle.exportKey("jwk", keyPair.publicKey);

            const storableDescriptors = descriptors.map(d => Array.from(d));

            const newUser = {
                faceDescriptors: JSON.stringify(storableDescriptors),
                publicKey: JSON.stringify(jwkPublicKey),
                createdAt: firebase.database.ServerValue.TIMESTAMP
            };

            try {
                await this.db.ref(`users/${uuid}`).set(newUser);
                const labeledDescriptors = new faceapi.LabeledFaceDescriptors(uuid, descriptors);
                const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, this.config.matchThreshold);
                
                this.state.myIdentity = { uuid, privateKey: keyPair.privateKey, faceMatcher };
                await this.identity.saveToStorage(uuid, storableDescriptors, keyPair.privateKey);
                
                this.ui.updateStatus("Identity created successfully!", "bg-green-500", 2000);
                this.video.stop('videoStream');
                this.ui.showChatView();
            } catch (e) {
                this.ui.updateStatus("Firebase Save Error. See console.", "bg-red-500");
                console.error("Firebase database set error:", e);
                this.elements.registerBtn.disabled = false;
            }

        }, this.config.registrationScanDuration);
    },

    async faceLogin() {
        this.ui.updateStatus("Please verify your face to login...", "bg-blue-500");
        const success = await this.modal.openVerification();
        if (success) {
            this.ui.updateStatus("Login successful!", "bg-green-500", 2000);
            await this.identity.goOnline();
        } else {
            this.ui.updateStatus("Login failed. Refresh to try again.", "bg-red-500");
            this.elements.chatView.innerHTML = '<h1>Login Failed. Please refresh the page.</h1>';
        }
    },

    // ========================
    // IDENTITY & PRESENCE MANAGEMENT
    // ========================
    identity: {
        async loadFromStorage() {
            const storedIdentity = localStorage.getItem('secure-chat-identity');
            if (!storedIdentity) return null;
            
            try {
                const { uuid, jwkPrivateKey, faceDescriptors } = JSON.parse(storedIdentity);
                const privateKey = await self.crypto.subtle.importKey(
                    "jwk", jwkPrivateKey, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]
                );
                const descriptors = faceDescriptors.map(d => new Float32Array(d));
                const labeledDescriptors = new faceapi.LabeledFaceDescriptors(uuid, descriptors);
                const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, App.config.matchThreshold);
                
                return { uuid, privateKey, faceMatcher };
            } catch (e) {
                console.error("Failed to load identity from storage:", e);
                localStorage.removeItem('secure-chat-identity');
                return null;
            }
        },

        async saveToStorage(uuid, faceDescriptors, privateKey) {
            const jwkPrivateKey = await self.crypto.subtle.exportKey("jwk", privateKey);
            const storableIdentity = {
                uuid,
                jwkPrivateKey,
                faceDescriptors
            };
            localStorage.setItem('secure-chat-identity', JSON.stringify(storableIdentity));
        },

        async goOnline() {
            const userStatusRef = App.db.ref(`/onlineUsers/${App.state.myIdentity.uuid}`);
            await userStatusRef.onDisconnect().remove();
            await userStatusRef.set(true);
            console.log("User is online.");
        },

        async logout() {
            const userStatusRef = App.db.ref(`/onlineUsers/${App.state.myIdentity.uuid}`);
            await userStatusRef.remove();
            
            localStorage.removeItem('secure-chat-identity');
            localStorage.removeItem('secure-chat-device-uuid');
            window.location.reload();
        }
    },
    
    // ========================
    // CHAT LOGIC
    // ========================
    chat: {
        listenForUsers() {
            const onlineUsersRef = App.db.ref('onlineUsers');

            onlineUsersRef.on('child_added', async snapshot => {
                const uuid = snapshot.key;
                if (uuid === App.state.myIdentity.uuid) return;

                if (document.getElementById(`user-${uuid}`)) return;

                const placeholder = App.elements.userList.querySelector('.placeholder');
                if (placeholder) placeholder.remove();

                const userDetailsSnapshot = await App.db.ref(`users/${uuid}`).once('value');
                const userDetails = userDetailsSnapshot.val();

                if (userDetails) {
                    const userElement = document.createElement('div');
                    userElement.id = `user-${uuid}`;
                    userElement.textContent = `User ${uuid.substring(0, 8)}...`;
                    userElement.onclick = () => App.chat.start(uuid, userDetails.publicKey);
                    App.elements.userList.appendChild(userElement);
                }
            });

            onlineUsersRef.on('child_removed', snapshot => {
                const uuid = snapshot.key;
                const userElement = document.getElementById(`user-${uuid}`);
                if (userElement) {
                    userElement.remove();
                }

                if (App.elements.userList.children.length === 0) {
                    App.elements.userList.innerHTML = '<p class="text-gray-400 placeholder">No other users online.</p>';
                }
            });
        },

        async start(uuid, publicKeyString) {
            const publicKey = JSON.parse(publicKeyString);
            App.state.currentChatPartner = { uuid, publicKey };
            App.elements.chatPartnerUuidDisplay.textContent = uuid.substring(0, 8) + '...';
            App.elements.messageInput.disabled = false;
            App.elements.sendBtn.disabled = false;
            App.elements.chatWindow.innerHTML = '';
            
            const cacheKey = [App.state.myIdentity.uuid, uuid].sort().join('-');
            if (!App.state.sharedSecretCache[cacheKey]) {
                App.state.sharedSecretCache[cacheKey] = await App.crypto.deriveSharedSecret(App.state.myIdentity.privateKey, publicKey);
            }

            this.listenForMessages(uuid);
        },

        async startManualChat() {
            const uuid = App.elements.manualUuidInput.value.trim();
            if (!uuid || uuid === App.state.myIdentity.uuid) {
                App.ui.updateStatus("Please enter a valid UUID.", "bg-yellow-500", 3000);
                return;
            }

            const userDetailsSnapshot = await App.db.ref(`users/${uuid}`).once('value');
            if (!userDetailsSnapshot.exists()) {
                App.ui.updateStatus("User with that UUID not found.", "bg-red-500", 3000);
                return;
            }

            const userDetails = userDetailsSnapshot.val();
            this.start(uuid, userDetails.publicKey);
            App.elements.manualUuidInput.value = ''; // Clear input
        },

        async sendMessage() {
            const text = App.elements.messageInput.value.trim();
            if (!text || !App.state.currentChatPartner) return;
            
            const messageContent = { type: 'text', content: text };
            App.elements.messageInput.value = '';

            const cacheKey = [App.state.myIdentity.uuid, App.state.currentChatPartner.uuid].sort().join('-');
            const sharedKey = App.state.sharedSecretCache[cacheKey];
            if (!sharedKey) {
                App.ui.updateStatus("Error: No shared secret.", "bg-red-500");
                return;
            }

            const encryptedData = await App.crypto.encryptMessage(JSON.stringify(messageContent), sharedKey);
            const message = {
                senderId: App.state.myIdentity.uuid,
                ...encryptedData,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            };

            const chatId = [App.state.myIdentity.uuid, App.state.currentChatPartner.uuid].sort().join('_');
            await App.db.ref(`chats/${chatId}`).push().set(message);
        },

        listenForMessages(partnerUuid) {
            const chatId = [App.state.myIdentity.uuid, partnerUuid].sort().join('_');
            const messagesRef = App.db.ref(`chats/${chatId}`).orderByChild('timestamp');
            
            if (App.state.activeChatListener) {
                App.state.activeChatListener.off();
            }
            App.state.activeChatListener = messagesRef;

            messagesRef.on('child_added', snapshot => {
                this.renderMessage(snapshot.val(), snapshot.key, partnerUuid);
            });

            messagesRef.on('child_removed', snapshot => {
                const messageId = snapshot.key;
                const messageElement = document.getElementById(`msg-${messageId}`);
                if (messageElement) {
                    messageElement.remove();
                }
            });
        },
        
        async renderMessage(encryptedMessage, messageId, partnerUuid) {
            const msgDiv = document.createElement('div');
            msgDiv.id = `msg-${messageId}`;
            const content = document.createElement('p');
            
            const isSent = encryptedMessage.senderId === App.state.myIdentity.uuid;
            msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;
            
            const messageContentWrapper = document.createElement('div');
            messageContentWrapper.style.display = 'flex';
            messageContentWrapper.style.alignItems = 'center';
            messageContentWrapper.style.gap = '10px';

            messageContentWrapper.appendChild(content);
            msgDiv.appendChild(messageContentWrapper);

            if (isSent) {
                const cacheKey = [App.state.myIdentity.uuid, partnerUuid].sort().join('-');
                const sharedKey = App.state.sharedSecretCache[cacheKey];
                const decryptedJson = await App.crypto.decryptMessage(encryptedMessage, sharedKey);
                const messageData = JSON.parse(decryptedJson);
                content.textContent = messageData.content;

                const deleteBtn = document.createElement('button');
                deleteBtn.innerHTML = '&#128465;';
                deleteBtn.className = 'delete-btn';
                deleteBtn.onclick = () => this.deleteMessage(messageId, partnerUuid);
                messageContentWrapper.appendChild(deleteBtn);

            } else {
                content.textContent = "🔒 Encrypted Message. Click to decrypt.";
                msgDiv.classList.add('clickable');
                msgDiv.onclick = async () => {
                    const success = await App.modal.openVerification();
                    if (success) {
                        const partnerData = (await App.db.ref(`users/${encryptedMessage.senderId}`).once('value')).val();
                        const partnerPublicKey = JSON.parse(partnerData.publicKey);
                        const cacheKey = [App.state.myIdentity.uuid, encryptedMessage.senderId].sort().join('-');
                        if (!App.state.sharedSecretCache[cacheKey]) {
                            App.state.sharedSecretCache[cacheKey] = await App.crypto.deriveSharedSecret(App.state.myIdentity.privateKey, partnerPublicKey);
                        }
                        const sharedKey = App.state.sharedSecretCache[cacheKey];
                        const decryptedJson = await App.crypto.decryptMessage(encryptedMessage, sharedKey);
                        const messageData = JSON.parse(decryptedJson);
                        
                        content.textContent = messageData.content;
                        msgDiv.classList.add('decrypted');
                        msgDiv.onclick = null;
                    }
                };
            }
            App.elements.chatWindow.appendChild(msgDiv);
            App.elements.chatWindow.scrollTop = App.elements.chatWindow.scrollHeight;
        },

        async deleteMessage(messageId, partnerUuid) {
            const chatId = [App.state.myIdentity.uuid, partnerUuid].sort().join('_');
            await App.db.ref(`chats/${chatId}/${messageId}`).remove();
        }
    },
    
    // ========================
    // VIDEO & FACE-API
    // ========================
    video: {
        async start(videoEl, canvasEl, streamStateKey) {
            if (App.state[streamStateKey]) return;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
                App.state[streamStateKey] = stream;
                videoEl.srcObject = stream;
                return new Promise(resolve => {
                    videoEl.onloadedmetadata = () => {
                        faceapi.matchDimensions(canvasEl, { width: videoEl.videoWidth, height: videoEl.videoHeight });
                        resolve();
                    };
                });
            } catch (e) {
                App.ui.updateStatus("Webcam access denied.", "bg-red-500");
            }
        },
        stop(streamStateKey) {
            const stream = App.state[streamStateKey];
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                App.state[streamStateKey] = null;
            }
        }
    },
    
    face: {
        async getDescriptor(videoEl) {
            const detection = await faceapi.detectSingleFace(videoEl, App.config.faceapiOptions).withFaceLandmarks().withFaceDescriptor();
            return detection ? detection.descriptor : null;
        }
    },

    // ========================
    // DECRYPTION MODAL
    // ========================
    modal: {
        openVerification() {
            return new Promise(async (resolve) => {
                App.elements.decryptModal.classList.remove('hidden');
                await App.video.start(App.elements.modalVideo, App.elements.modalCanvas, 'modalVideoStream');

                const verifyHandler = async () => {
                    const descriptor = await App.face.getDescriptor(App.elements.modalVideo);
                    if (descriptor) {
                        const bestMatch = App.state.myIdentity.faceMatcher.findBestMatch(descriptor);
                        const isMatch = bestMatch.label !== 'unknown';
                        
                        const feedbackMsg = `Match: ${isMatch}. Distance: ${bestMatch.distance.toFixed(2)}`;
                        App.ui.updateStatus(feedbackMsg, isMatch ? "bg-green-500" : "bg-red-500", 3000);
                        
                        cleanupAndResolve(isMatch);
                    } else {
                        App.ui.updateStatus("No face detected.", "bg-yellow-500", 2000);
                        cleanupAndResolve(false);
                    }
                };
                
                const cancelHandler = () => cleanupAndResolve(false);

                const cleanupAndResolve = (result) => {
                    App.elements.verifyDecryptBtn.removeEventListener('click', verifyHandler);
                    App.elements.cancelDecryptBtn.removeEventListener('click', cancelHandler);
                    App.video.stop('modalVideoStream');
                    App.elements.decryptModal.classList.add('hidden');
                    resolve(result);
                };

                App.elements.verifyDecryptBtn.addEventListener('click', verifyHandler);
                App.elements.cancelDecryptBtn.addEventListener('click', cancelHandler);
            });
        }
    },

    // ========================
    // CRYPTO UTILITIES
    // ========================
    crypto: {
        async generateECDHKeyPair() {
            return await self.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
        },
        async deriveSharedSecret(privateKey, publicKey) {
            const publicCryptoKey = await self.crypto.subtle.importKey("jwk", publicKey, { name: "ECDH", namedCurve: "P-256" }, true, []);
            return await self.crypto.subtle.deriveKey({ name: "ECDH", public: publicCryptoKey }, privateKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        },
        async encryptMessage(message, sharedKey) {
            const iv = self.crypto.getRandomValues(new Uint8Array(12));
            const encodedMessage = new TextEncoder().encode(message);
            const ciphertext = await self.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, sharedKey, encodedMessage);
            const toBase64 = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer)));
            return { ciphertext: toBase64(ciphertext), iv: toBase64(iv) };
        },
        async decryptMessage(encryptedData, sharedKey) {
            try {
                const fromBase64 = base64 => new Uint8Array(atob(base64).split("").map(c => c.charCodeAt(0)));
                const decryptedBuffer = await self.crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(encryptedData.iv) }, sharedKey, fromBase64(encryptedData.ciphertext));
                return new TextDecoder().decode(decryptedBuffer);
            } catch (e) {
                return "Decryption Failed.";
            }
        }
    }
};

// Start the application once the DOM is fully loaded.
window.addEventListener('DOMContentLoaded', () => App.init());
