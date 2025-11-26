/**
 * Video to ASCII Converter - Client-side JavaScript implementation
 * Converts video frames to ASCII art entirely in the browser
 */

class VideoToAsciiConverter {
    constructor(options = {}) {
        this.asciiChars = options.asciiChars || 'F$V* ';
        this.charWidth = 10;
        this.charHeight = 18;
        this.whiteThreshold = 240;
        this.noiseLevel = options.noiseLevel || 0.15;
        this.onProgress = options.onProgress || (() => {});
    }

    getBrightness(r, g, b) {
        return 0.299 * r + 0.587 * g + 0.114 * b;
    }

    getColorAsciiChar(r, g, b) {
        const brightness = this.getBrightness(r, g, b);

        if (brightness >= this.whiteThreshold) {
            return { char: null, color: { r, g, b } };
        }

        let charIndex = Math.floor((brightness / this.whiteThreshold) * (this.asciiChars.length - 1));
        charIndex = Math.min(charIndex, this.asciiChars.length - 2);

        if (this.noiseLevel > 0 && this.asciiChars.length > 2) {
            if (Math.random() < this.noiseLevel) {
                const shift = Math.random() < 0.5 ? -1 : 1;
                charIndex = Math.max(0, Math.min(this.asciiChars.length - 2, charIndex + shift));
            }
        }

        return {
            char: this.asciiChars[charIndex],
            color: { r, g, b }
        };
    }

    maximizeContrast(imageData) {
        const data = imageData.data;

        let minL = 255, maxL = 0;
        for (let i = 0; i < data.length; i += 4) {
            const l = this.getBrightness(data[i], data[i + 1], data[i + 2]);
            minL = Math.min(minL, l);
            maxL = Math.max(maxL, l);
        }

        const range = maxL - minL || 1;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const l = this.getBrightness(r, g, b);
            const newL = ((l - minL) / range) * 255;
            const factor = l > 0 ? newL / l : 1;

            data[i] = Math.min(255, Math.max(0, r * factor));
            data[i + 1] = Math.min(255, Math.max(0, g * factor));
            data[i + 2] = Math.min(255, Math.max(0, b * factor));
        }

        return imageData;
    }

    frameToAscii(sourceCanvas, outputCanvas, asciiWidth) {
        const sourceCtx = sourceCanvas.getContext('2d');
        const outputCtx = outputCanvas.getContext('2d');

        const aspectRatio = sourceCanvas.height / sourceCanvas.width;
        const charAspect = this.charHeight / this.charWidth;
        const asciiHeight = Math.floor(asciiWidth * aspectRatio / charAspect);

        const imgWidth = asciiWidth * this.charWidth;
        const imgHeight = asciiHeight * this.charHeight;
        outputCanvas.width = imgWidth;
        outputCanvas.height = imgHeight;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = asciiWidth;
        tempCanvas.height = asciiHeight;
        const tempCtx = tempCanvas.getContext('2d');

        tempCtx.drawImage(sourceCanvas, 0, 0, asciiWidth, asciiHeight);
        let imageData = tempCtx.getImageData(0, 0, asciiWidth, asciiHeight);

        imageData = this.maximizeContrast(imageData);
        const pixels = imageData.data;

        outputCtx.fillStyle = '#ffffff';
        outputCtx.fillRect(0, 0, imgWidth, imgHeight);

        outputCtx.font = '14px monospace';
        outputCtx.textBaseline = 'top';

        for (let y = 0; y < asciiHeight; y++) {
            for (let x = 0; x < asciiWidth; x++) {
                const idx = (y * asciiWidth + x) * 4;
                const r = pixels[idx];
                const g = pixels[idx + 1];
                const b = pixels[idx + 2];

                const { char, color } = this.getColorAsciiChar(r, g, b);

                if (char === null) continue;

                const posX = x * this.charWidth;
                const posY = y * this.charHeight;
                outputCtx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
                outputCtx.fillText(char, posX, posY);
            }
        }

        return { width: imgWidth, height: imgHeight };
    }

    async extractFrames(video, targetFps, onFrame) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const duration = video.duration;
            const frameInterval = 1 / targetFps;
            const totalFrames = Math.floor(duration * targetFps);

            let currentFrame = 0;

            const extractFrame = () => {
                if (currentFrame >= totalFrames) {
                    resolve(totalFrames);
                    return;
                }

                const time = currentFrame * frameInterval;
                video.currentTime = time;
            };

            video.onseeked = () => {
                ctx.drawImage(video, 0, 0);
                onFrame(canvas, currentFrame, totalFrames);
                currentFrame++;

                this.onProgress({
                    stage: 'extracting',
                    current: currentFrame,
                    total: totalFrames,
                    percent: Math.round((currentFrame / totalFrames) * 50)
                });

                setTimeout(extractFrame, 0);
            };

            video.onerror = reject;
            extractFrame();
        });
    }

    async extractAudio(videoFile) {
        const audioContext = new AudioContext();
        const arrayBuffer = await videoFile.arrayBuffer();

        try {
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            return audioBuffer;
        } catch (e) {
            console.log('No audio track or failed to decode audio');
            return null;
        }
    }

    audioBufferToWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;

        const samples = audioBuffer.length;
        const dataSize = samples * blockAlign;
        const bufferSize = 44 + dataSize;

        const buffer = new ArrayBuffer(bufferSize);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, bufferSize - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        // Interleave channels and write samples
        const channels = [];
        for (let i = 0; i < numChannels; i++) {
            channels.push(audioBuffer.getChannelData(i));
        }

        let offset = 44;
        for (let i = 0; i < samples; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, channels[ch][i]));
                const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, intSample, true);
                offset += 2;
            }
        }

        return buffer;
    }

    async convert(videoFile, options = {}) {
        const { fps = 15, asciiWidth = 120, includeAudio = true } = options;

        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;

        // Extract audio in parallel if requested
        const audioPromise = includeAudio ? this.extractAudio(videoFile) : Promise.resolve(null);

        return new Promise((resolve, reject) => {
            video.onloadedmetadata = async () => {
                try {
                    const outputCanvas = document.createElement('canvas');
                    const frames = [];

                    this.onProgress({ stage: 'loading', percent: 0 });

                    await this.extractFrames(video, fps, (frameCanvas, frameNum, totalFrames) => {
                        const { width, height } = this.frameToAscii(frameCanvas, outputCanvas, asciiWidth);

                        frames.push({
                            data: outputCanvas.toDataURL('image/png'),
                            width,
                            height
                        });

                        this.onProgress({
                            stage: 'converting',
                            current: frameNum + 1,
                            total: totalFrames,
                            percent: 50 + Math.round(((frameNum + 1) / totalFrames) * 40)
                        });
                    });

                    this.onProgress({ stage: 'encoding', percent: 90 });

                    const audioBuffer = await audioPromise;
                    const result = await this.createMp4FromFrames(frames, fps, audioBuffer);

                    this.onProgress({ stage: 'complete', percent: 100 });

                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };

            video.onerror = () => reject(new Error('Failed to load video'));
            video.src = URL.createObjectURL(videoFile);
        });
    }

    async createMp4FromFrames(frames, fps, audioBuffer = null) {
        if (frames.length === 0) {
            throw new Error('No frames to encode');
        }

        const { width, height } = frames[0];
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Use VideoEncoder API with mp4-muxer for proper MP4 output
        if (typeof VideoEncoder !== 'undefined' && typeof Mp4Muxer !== 'undefined') {
            return await this.encodeWithVideoEncoder(frames, fps, width, height, canvas, ctx, audioBuffer);
        }

        // Fallback to MediaRecorder (WebM)
        return await this.encodeWithMediaRecorder(frames, fps, width, height, canvas, ctx);
    }

    async encodeWithVideoEncoder(frames, fps, width, height, canvas, ctx, audioBuffer = null) {
        return new Promise(async (resolve, reject) => {
            try {
                // Test if audio encoder will work before adding audio track to muxer
                let canEncodeAudio = false;
                if (audioBuffer && typeof AudioEncoder !== 'undefined') {
                    try {
                        const testSupport = await AudioEncoder.isConfigSupported({
                            codec: 'mp4a.40.2',
                            numberOfChannels: audioBuffer.numberOfChannels,
                            sampleRate: audioBuffer.sampleRate,
                            bitrate: 320000
                        });
                        canEncodeAudio = testSupport.supported;
                    } catch (e) {
                        console.log('Audio encoding not supported:', e);
                        canEncodeAudio = false;
                    }
                }

                const muxerConfig = {
                    target: new Mp4Muxer.ArrayBufferTarget(),
                    video: {
                        codec: 'avc',
                        width: width,
                        height: height
                    },
                    fastStart: 'in-memory'
                };

                // Only add audio track if we can actually encode audio
                if (canEncodeAudio && audioBuffer) {
                    muxerConfig.audio = {
                        codec: 'aac',
                        numberOfChannels: audioBuffer.numberOfChannels,
                        sampleRate: audioBuffer.sampleRate
                    };
                }

                const muxer = new Mp4Muxer.Muxer(muxerConfig);

                let encoderClosed = false;

                const videoEncoder = new VideoEncoder({
                    output: (chunk, meta) => {
                        muxer.addVideoChunk(chunk, meta);
                    },
                    error: (e) => {
                        console.error('VideoEncoder error:', e);
                        reject(e);
                    }
                });

                videoEncoder.configure({
                    codec: 'avc1.640034',
                    width: width,
                    height: height,
                    bitrate: 10_000_000,
                    framerate: fps
                });

                // Set up audio encoder if we can encode audio
                let audioEncoder = null;
                let audioEncoderError = null;
                if (canEncodeAudio && audioBuffer) {
                    try {
                        audioEncoder = new AudioEncoder({
                            output: (chunk, meta) => {
                                muxer.addAudioChunk(chunk, meta);
                            },
                            error: (e) => {
                                console.error('AudioEncoder error:', e);
                                audioEncoderError = e;
                            }
                        });

                        audioEncoder.configure({
                            codec: 'mp4a.40.2',
                            numberOfChannels: audioBuffer.numberOfChannels,
                            sampleRate: audioBuffer.sampleRate,
                            bitrate: 320000
                        });
                    } catch (e) {
                        console.error('Failed to create audio encoder:', e);
                        audioEncoder = null;
                    }
                }

                const frameDuration = 1_000_000 / fps; // microseconds

                // Load all images first
                const images = [];
                for (let i = 0; i < frames.length; i++) {
                    const img = new Image();
                    await new Promise((res, rej) => {
                        img.onload = res;
                        img.onerror = rej;
                        img.src = frames[i].data;
                    });
                    images.push(img);
                }

                // Encode all video frames
                for (let i = 0; i < images.length; i++) {
                    if (encoderClosed) break;

                    ctx.drawImage(images[i], 0, 0);

                    const videoFrame = new VideoFrame(canvas, {
                        timestamp: i * frameDuration,
                        duration: frameDuration
                    });

                    videoEncoder.encode(videoFrame, { keyFrame: i % 30 === 0 });
                    videoFrame.close();

                    this.onProgress({
                        stage: 'encoding',
                        current: i + 1,
                        total: frames.length,
                        percent: 90 + Math.round(((i + 1) / frames.length) * 10)
                    });
                }

                // Encode audio if available
                if (audioEncoder && audioBuffer && !audioEncoderError) {
                    try {
                        const numberOfChannels = audioBuffer.numberOfChannels;
                        const sampleRate = audioBuffer.sampleRate;
                        const totalSamples = audioBuffer.length;

                        // Encode in smaller chunks for better sync
                        const chunkSize = Math.floor(sampleRate / 10); // 100ms chunks
                        let timestamp = 0;

                        for (let offset = 0; offset < totalSamples; offset += chunkSize) {
                            // Check if encoder is still valid
                            if (audioEncoderError || audioEncoder.state === 'closed') {
                                console.warn('Audio encoder closed, skipping remaining audio');
                                break;
                            }

                            const remainingSamples = Math.min(chunkSize, totalSamples - offset);

                            // Create interleaved data (samples alternating between channels)
                            const interleavedData = new Float32Array(remainingSamples * numberOfChannels);
                            for (let i = 0; i < remainingSamples; i++) {
                                for (let ch = 0; ch < numberOfChannels; ch++) {
                                    interleavedData[i * numberOfChannels + ch] = audioBuffer.getChannelData(ch)[offset + i];
                                }
                            }

                            const audioData = new AudioData({
                                format: 'f32',
                                sampleRate: sampleRate,
                                numberOfFrames: remainingSamples,
                                numberOfChannels: numberOfChannels,
                                timestamp: timestamp,
                                data: interleavedData
                            });

                            audioEncoder.encode(audioData);
                            audioData.close();

                            timestamp += Math.round((remainingSamples / sampleRate) * 1_000_000); // microseconds
                        }

                        if (audioEncoder.state !== 'closed') {
                            await audioEncoder.flush();
                            audioEncoder.close();
                        }
                    } catch (e) {
                        console.error('Audio encoding failed:', e);
                        // Continue without audio
                    }
                }

                await videoEncoder.flush();
                videoEncoder.close();
                encoderClosed = true;
                muxer.finalize();

                const buffer = muxer.target.buffer;
                const blob = new Blob([buffer], { type: 'video/mp4' });

                resolve({
                    blob,
                    frames,
                    width,
                    height,
                    fps,
                    format: 'mp4'
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    async encodeWithMediaRecorder(frames, fps, width, height, canvas, ctx) {
        const stream = canvas.captureStream(fps);

        let mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp8';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
        }

        const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 5000000
        });

        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        };

        return new Promise((resolve, reject) => {
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                resolve({
                    blob,
                    frames,
                    width,
                    height,
                    fps,
                    format: 'webm'
                });
            };

            recorder.onerror = reject;
            recorder.start();

            let frameIndex = 0;
            const frameInterval = 1000 / fps;

            const drawNextFrame = () => {
                if (frameIndex >= frames.length) {
                    setTimeout(() => recorder.stop(), frameInterval * 2);
                    return;
                }

                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0);
                    frameIndex++;

                    this.onProgress({
                        stage: 'encoding',
                        current: frameIndex,
                        total: frames.length,
                        percent: 90 + Math.round((frameIndex / frames.length) * 10)
                    });

                    setTimeout(drawNextFrame, frameInterval);
                };
                img.src = frames[frameIndex].data;
            };

            drawNextFrame();
        });
    }
}

window.VideoToAsciiConverter = VideoToAsciiConverter;
