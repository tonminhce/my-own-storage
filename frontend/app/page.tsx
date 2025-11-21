'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence, m } from 'framer-motion';
import {
    Cloud, Upload, Download, File, FileText, FileVideo,
    FileAudio, FileImage, Folder, Trash2, Grid3x3, List,
    Search, Settings, User, Plus, Check, AlertCircle
} from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks

interface FileMetadata {
    id: string;
    name: string;
    size: number;
    mime_type: string;
    status: string;
    created_at: string;
    chunks: any[];
}

interface UploadProgress {
    fileName: string;
    progress: number;
    status: 'uploading' | 'completed' | 'error';
    uploadId?: string;
}

export default function DriveInterface() {
    const [files, setFiles] = useState<FileMetadata[]>([]);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch files
    const fetchFiles = useCallback(async () => {
        try {
            const response = await axios.get(`${API_URL}/files`);
            setFiles(response.data || []);
        } catch (error) {
            console.error('Error fetching files:', error);
        }
    }, []);

    // Upload file with parallel chunking and retry logic
    const uploadFile = async (file: File) => {
        try {
            // Initialize upload
            const initResponse = await axios.post(`${API_URL}/init`, {
                name: file.name,
                size: file.size,
                mime_type: file.type || 'application/octet-stream',
            });

            const uploadId = initResponse.data.id;
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            const CONCURRENCY_LIMIT = 14;

            setUploadProgress(prev => [...prev, {
                fileName: file.name,
                progress: 0,
                status: 'uploading',
                uploadId
            }]);

            // Create chunks queue
            let chunksCompleted = 0;
            const queue = Array.from({ length: totalChunks }, (_, i) => i);

            const uploadChunk = async (chunkIndex: number) => {
                const start = chunkIndex * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);

                const formData = new FormData();
                formData.append('file', chunk);
                formData.append('upload_id', uploadId);
                formData.append('sequence', chunkIndex.toString());

                const MAX_RETRIES = 3;
                let lastError;

                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                    try {
                        console.log(`[Chunk ${chunkIndex}] Attempt ${attempt + 1}/${MAX_RETRIES}`);
                        await axios.post(`${API_URL}/upload`, formData);
                        console.log(`[Chunk ${chunkIndex}] Finished!`);

                        chunksCompleted++;
                        const progress = (chunksCompleted / totalChunks) * 100;
                        setUploadProgress(prev => prev.map(p =>
                            p.uploadId === uploadId ? { ...p, progress } : p
                        ));
                        return; // Success
                    } catch (error) {
                        console.warn(`[Chunk ${chunkIndex}] Failed attempt ${attempt + 1}`, error);
                        lastError = error;
                        // Wait 1s * attempt before retry
                        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                    }
                }
                throw lastError; // Failed after all retries
            };

            // Process queue with concurrency limit
            const activeUploads: Promise<void>[] = [];

            for (const chunkIndex of queue) {
                const p = uploadChunk(chunkIndex).then(() => {
                    activeUploads.splice(activeUploads.indexOf(p), 1);
                });
                activeUploads.push(p);

                if (activeUploads.length >= CONCURRENCY_LIMIT) {
                    await Promise.race(activeUploads);
                }
            }

            // Wait for remaining uploads
            await Promise.all(activeUploads);

            // Complete upload
            await axios.post(`${API_URL}/complete`, { upload_id: uploadId });

            setUploadProgress(prev => prev.map(p =>
                p.uploadId === uploadId ? { ...p, status: 'completed' } : p
            ));

            setTimeout(() => {
                setUploadProgress(prev => prev.filter(p => p.uploadId !== uploadId));
                fetchFiles();
            }, 2000);

        } catch (error) {
            console.error('Upload error:', error);
            setUploadProgress(prev => prev.map(p =>
                p.fileName === file.name ? { ...p, status: 'error' } : p
            ));
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(uploadFile);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        const files = Array.from(e.dataTransfer.files);
        files.forEach(uploadFile);
    };

    const downloadFile = async (fileId: string, fileName: string) => {
        try {
            const response = await axios.get(`${API_URL}/download/${fileId}`, {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
        } catch (error) {
            console.error('Download error:', error);
        }
    };

    const getFileIcon = (mimeType: string) => {
        if (mimeType.startsWith('image/')) return FileImage;
        if (mimeType.startsWith('video/')) return FileVideo;
        if (mimeType.startsWith('audio/')) return FileAudio;
        if (mimeType.includes('text') || mimeType.includes('document')) return FileText;
        return File;
    };

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const filteredFiles = files.filter(file =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="min-h-screen flex">
            {/* Sidebar */}
            <motion.aside
                initial={{ x: -100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="w-64 glass border-r border-gray-200/50 p-6 flex flex-col"
            >
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                        <Cloud className="w-6 h-6 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                        CloudDrive
                    </h1>
                </div>

                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="glass hover:bg-white/90 text-blue-600 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 mb-6 hover:scale-105 transform transition-all shadow-lg hover:shadow-xl"
                >
                    <Plus className="w-5 h-5" />
                    New Upload
                </button>

                <nav className="flex-1 space-y-2">
                    {[
                        { icon: Folder, label: 'My Files', active: true },
                    ].map((item, i) => (
                        <motion.button
                            key={i}
                            whileHover={{ x: 4 }}
                            whileTap={{ scale: 0.98 }}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${item.active
                                ? 'bg-blue-50 text-blue-600'
                                : 'hover:bg-gray-100/50 text-gray-700'
                                }`}
                        >
                            <item.icon className="w-5 h-5" />
                            <span className="font-medium">{item.label}</span>
                        </motion.button>
                    ))}
                </nav>

                <div className="mt-auto space-y-2">
                    <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-100/50 text-gray-700 transition-all">
                        <Settings className="w-5 h-5" />
                        <span className="font-medium">Settings</span>
                    </button>
                </div>
            </motion.aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col">
                {/* Header */}
                <header className="glass border-b border-gray-200/50 px-8 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex-1 max-w-2xl">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search in files..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 rounded-xl bg-gray-100/50 border border-gray-200/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white transition-all"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-4 ml-6">
                            <div className="flex items-center gap-2 bg-gray-100/50 rounded-xl p-1">
                                <button
                                    onClick={() => setViewMode('grid')}
                                    className={`p-2 rounded-lg transition-all ${viewMode === 'grid'
                                        ? 'bg-white shadow-sm text-blue-600'
                                        : 'text-gray-600 hover:text-gray-900'
                                        }`}
                                >
                                    <Grid3x3 className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-2 rounded-lg transition-all ${viewMode === 'list'
                                        ? 'bg-white shadow-sm text-blue-600'
                                        : 'text-gray-600 hover:text-gray-900'
                                        }`}
                                >
                                    <List className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center cursor-pointer hover:scale-110 transition-transform">
                                <User className="w-5 h-5 text-white" />
                            </div>
                        </div>
                    </div>
                </header>

                {/* Upload Area with Drag & Drop */}
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    className="flex-1 p-8 overflow-y-auto"
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                    />

                    <AnimatePresence>
                        {dragActive && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 bg-blue-500/10 backdrop-blur-sm flex items-center justify-center z-50"
                            >
                                <div className="glass p-12 rounded-3xl text-center">
                                    <Upload className="w-16 h-16 mx-auto mb-4 text-blue-600" />
                                    <p className="text-2xl font-bold text-gray-900">Drop files here</p>
                                    <p className="text-gray-600 mt-2">to upload to CloudDrive</p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Upload Progress */}
                    <AnimatePresence>
                        {uploadProgress.length > 0 && (
                            <motion.div
                                initial={{ y: -20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -20, opacity: 0 }}
                                className="mb-6"
                            >
                                <h2 className="text-lg font-semibold mb-4 text-gray-900">Uploading</h2>
                                <div className="space-y-3">
                                    {uploadProgress.map((upload, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ scale: 0.9, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="glass p-4 rounded-xl"
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="font-medium text-gray-900 flex items-center gap-2">
                                                    <File className="w-4 h-4" />
                                                    {upload.fileName}
                                                </span>
                                                {upload.status === 'completed' && (
                                                    <Check className="w-5 h-5 text-green-500" />
                                                )}
                                                {upload.status === 'error' && (
                                                    <AlertCircle className="w-5 h-5 text-red-500" />
                                                )}
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${upload.progress}%` }}
                                                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
                                                />
                                            </div>
                                            <p className="text-sm text-gray-600 mt-1">
                                                {upload.progress.toFixed(0)}%
                                            </p>
                                        </motion.div>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Files Section */}
                    {filteredFiles.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col items-center justify-center h-96"
                        >
                            <div className="w-32 h-32 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-3xl flex items-center justify-center mb-6">
                                <Cloud className="w-16 h-16 text-blue-600" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 mb-2">No files yet</h3>
                            <p className="text-gray-600 mb-6">Upload your first file to get started</p>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:scale-105 transform transition-all shadow-lg hover:shadow-xl"
                            >
                                Upload Files
                            </button>
                        </motion.div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-lg font-semibold text-gray-900">
                                    My Files ({filteredFiles.length})
                                </h2>
                            </div>

                            {viewMode === 'grid' ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {filteredFiles.map((file, i) => {
                                        const Icon = getFileIcon(file.mime_type);
                                        return (
                                            <motion.div
                                                key={file.id}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: i * 0.05 }}
                                                whileHover={{ y: -4 }}
                                                className="glass p-6 rounded-2xl cursor-pointer hover:shadow-2xl transition-all group"
                                                onClick={() => downloadFile(file.id, file.name)}
                                            >
                                                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center mb-4">
                                                    <Icon className="w-6 h-6 text-white" />
                                                </div>
                                                <h3 className="font-semibold text-gray-900 mb-1 truncate group-hover:text-blue-600 transition-colors">
                                                    {file.name}
                                                </h3>
                                                <p className="text-sm text-gray-600">
                                                    {formatFileSize(file.size)}
                                                </p>
                                                <p className="text-xs text-gray-500 mt-2">
                                                    {formatDate(file.created_at)}
                                                </p>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="glass rounded-2xl overflow-hidden">
                                    <table className="w-full">
                                        <thead className="bg-gray-50/50">
                                            <tr className="text-left text-sm text-gray-600">
                                                <th className="px-6 py-4 font-semibold">Name</th>
                                                <th className="px-6 py-4 font-semibold">Size</th>
                                                <th className="px-6 py-4 font-semibold">Date</th>
                                                <th className="px-6 py-4 font-semibold">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredFiles.map((file, i) => {
                                                const Icon = getFileIcon(file.mime_type);
                                                return (
                                                    <motion.tr
                                                        key={file.id}
                                                        initial={{ opacity: 0, x: -20 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        transition={{ delay: i * 0.03 }}
                                                        className="border-t border-gray-100 hover:bg-gray-50/50 transition-colors"
                                                    >
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                                                                    <Icon className="w-5 h-5 text-white" />
                                                                </div>
                                                                <span className="font-medium text-gray-900">{file.name}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-gray-600">{formatFileSize(file.size)}</td>
                                                        <td className="px-6 py-4 text-gray-600">{formatDate(file.created_at)}</td>
                                                        <td className="px-6 py-4">
                                                            <button
                                                                onClick={() => downloadFile(file.id, file.name)}
                                                                className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 hover:scale-110 transform transition-all"
                                                            >
                                                                <Download className="w-5 h-5" />
                                                            </button>
                                                        </td>
                                                    </motion.tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
