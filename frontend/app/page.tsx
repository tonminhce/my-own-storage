'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Cloud, Upload, Download, File, FileText, FileVideo,
    FileAudio, FileImage, Folder, Grid3x3, List,
    Search, Settings, User, Plus, Check, AlertCircle, Menu, X, Star, Clock, Trash2
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://tonminhce.site';
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
    const pathname = usePathname();
    const [files, setFiles] = useState<FileMetadata[]>([]);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(true); // Start as true to hide sidebar initially on mobile
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Detect mobile on mount and resize
    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth < 1024;
            setIsMobile(mobile);
            // Auto-close sidebar when resizing to desktop
            if (!mobile && sidebarOpen) {
                setSidebarOpen(false);
            }
        };
        // Initial check
        if (typeof window !== 'undefined') {
            checkMobile();
            window.addEventListener('resize', checkMobile);
            return () => window.removeEventListener('resize', checkMobile);
        }
    }, [sidebarOpen]);

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

            const failedChunks: number[] = [];
            
            const uploadChunk = async (chunkIndex: number, retryCount = 0): Promise<boolean> => {
                const start = chunkIndex * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);

                const formData = new FormData();
                formData.append('file', chunk);
                formData.append('upload_id', uploadId);
                formData.append('sequence', chunkIndex.toString());

                const MAX_RETRIES = 3;
                let lastError: any;

                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                    try {
                        console.log(`[Chunk ${chunkIndex}] Attempt ${attempt + 1}/${MAX_RETRIES}`);
                        await axios.post(`${API_URL}/upload`, formData, {
                            timeout: 60000, // 60 second timeout
                        });
                        console.log(`[Chunk ${chunkIndex}] Finished!`);

                        chunksCompleted++;
                        const progress = (chunksCompleted / totalChunks) * 100;
                        setUploadProgress(prev => prev.map(p =>
                            p.uploadId === uploadId ? { ...p, progress } : p
                        ));
                        return true; // Success
                    } catch (error: any) {
                        console.warn(`[Chunk ${chunkIndex}] Failed attempt ${attempt + 1}`, error);
                        lastError = error;
                        // Exponential backoff: wait longer between retries
                        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
                
                // After all retries failed, don't throw - return false instead
                console.error(`[Chunk ${chunkIndex}] Failed after ${MAX_RETRIES} attempts`);
                return false;
            };

            // Process queue with concurrency limit
            const activeUploads: Promise<{ index: number; success: boolean }>[] = [];
            const chunkResults: Map<number, boolean> = new Map();

            for (const chunkIndex of queue) {
                const p = uploadChunk(chunkIndex).then((success) => {
                    chunkResults.set(chunkIndex, success);
                    if (!success) {
                        failedChunks.push(chunkIndex);
                    }
                    return { index: chunkIndex, success };
                }).catch(() => {
                    chunkResults.set(chunkIndex, false);
                    failedChunks.push(chunkIndex);
                    return { index: chunkIndex, success: false };
                });
                
                activeUploads.push(p);

                if (activeUploads.length >= CONCURRENCY_LIMIT) {
                    await Promise.race(activeUploads);
                }
            }

            // Wait for remaining uploads - use allSettled to continue even if some fail
            await Promise.allSettled(activeUploads);

            // Retry failed chunks with exponential backoff
            if (failedChunks.length > 0) {
                console.log(`Retrying ${failedChunks.length} failed chunks...`);
                const MAX_RETRY_ROUNDS = 3;
                
                for (let round = 0; round < MAX_RETRY_ROUNDS && failedChunks.length > 0; round++) {
                    const chunksToRetry = [...failedChunks];
                    failedChunks.length = 0; // Clear array
                    
                    const retryPromises = chunksToRetry.map(chunkIndex => 
                        uploadChunk(chunkIndex, round).then((success) => {
                            if (!success) {
                                failedChunks.push(chunkIndex);
                            }
                            return { index: chunkIndex, success };
                        }).catch(() => {
                            failedChunks.push(chunkIndex);
                            return { index: chunkIndex, success: false };
                        })
                    );
                    
                    await Promise.allSettled(retryPromises);
                    
                    // Wait before next round
                    if (failedChunks.length > 0 && round < MAX_RETRY_ROUNDS - 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000 * (round + 1)));
                    }
                }
            }

            // Check if we have any failed chunks remaining
            if (failedChunks.length > 0) {
                throw new Error(`Failed to upload ${failedChunks.length} chunks after multiple retry attempts. Please try again.`);
            }

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
        <div className="min-h-screen flex relative bg-gray-50 dark:bg-gray-900">
            {/* Mobile Overlay */}
            <AnimatePresence>
                {sidebarOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSidebarOpen(false)}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
                        />
                    </>
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside
                className={`
                    fixed lg:static inset-y-0 left-0 z-50
                    w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700
                    p-4 sm:p-6 flex flex-col
                    transition-transform duration-300 ease-in-out
                    ${isMobile 
                        ? (sidebarOpen ? 'translate-x-0' : '-translate-x-full') 
                        : 'translate-x-0'
                    }
                    ${isMobile && !sidebarOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}
                `}
            >
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Cloud className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="text-xl font-medium text-gray-900 dark:text-white">
                            CloudDrive
                        </h1>
                    </div>
                    <button
                        onClick={() => setSidebarOpen(false)}
                        className="lg:hidden p-1.5 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </button>
                </div>

                <button
                    onClick={() => {
                        fileInputRef.current?.click();
                        setSidebarOpen(false);
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 mb-2 transition-colors w-full shadow-sm"
                >
                    <Plus className="w-5 h-5" />
                    <span className="hidden sm:inline">New</span>
                    <span className="sm:hidden">New</span>
                </button>

                <nav className="flex-1 space-y-1 mt-2">
                    {[
                        { icon: Folder, label: 'My Drive', href: '/', id: 'drive' },
                        { icon: Clock, label: 'Recent', href: '/recent', id: 'recent' },
                        { icon: Star, label: 'Starred', href: '/starred', id: 'starred' },
                        { icon: Trash2, label: 'Trash', href: '/trash', id: 'trash' },
                    ].map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.id}
                                href={item.href}
                                onClick={() => setSidebarOpen(false)}
                            className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-lg transition-colors text-left ${
                                isActive
                                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-medium'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                            >
                                <item.icon className="w-5 h-5 flex-shrink-0" />
                                <span className="text-sm">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className="mt-auto pt-2 border-t border-gray-200">
                    <Link
                        href="/settings"
                        onClick={() => setSidebarOpen(false)}
                        className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-lg transition-colors text-left ${
                            pathname === '/settings'
                                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-medium'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                    >
                        <Settings className="w-5 h-5 flex-shrink-0" />
                        <span className="text-sm">Settings</span>
                    </Link>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 bg-gray-50 dark:bg-gray-900">
                {/* Header */}
                <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 lg:px-8 py-3 sm:py-4 sticky top-0 z-30">
                    <div className="flex items-center gap-3 sm:gap-4">
                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="lg:hidden p-2 hover:bg-gray-100/50 rounded-lg transition-colors flex-shrink-0"
                        >
                            <Menu className="w-6 h-6 text-gray-700 dark:text-gray-300" />
                        </button>

                        {/* Search Bar */}
                        <div className="flex-1 min-w-0">
                            <div className="relative">
                                <Search className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400 dark:text-gray-500" />
                                <input
                                    type="text"
                                    placeholder="Search in Drive"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-10 sm:pl-12 pr-4 py-2.5 sm:py-3 rounded-lg bg-gray-100 dark:bg-gray-700 border-0 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-600 transition-all text-sm sm:text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                                />
                            </div>
                        </div>

                        {/* View Toggle & User */}
                        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                            <div className="flex items-center gap-1 sm:gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                                <button
                                    onClick={() => setViewMode('grid')}
                                    className={`p-2 rounded transition-colors ${viewMode === 'grid'
                                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                    aria-label="Grid view"
                                >
                                    <Grid3x3 className="w-4 h-4 sm:w-5 sm:h-5" />
                                </button>
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-2 rounded transition-colors ${viewMode === 'list'
                                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                    aria-label="List view"
                                >
                                    <List className="w-4 h-4 sm:w-5 sm:h-5" />
                                </button>
                            </div>

                            <Link
                                href="/profile"
                                className="w-8 h-8 sm:w-9 sm:h-9 bg-gray-300 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-400 transition-colors flex-shrink-0"
                            >
                                <User className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                            </Link>
                        </div>
                    </div>
                </header>

                {/* Upload Area with Drag & Drop */}
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto"
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
                                className="fixed inset-0 bg-blue-50/80 backdrop-blur-sm flex items-center justify-center z-50"
                            >
                                <div className="bg-white dark:bg-gray-800 p-8 sm:p-12 rounded-lg border-2 border-dashed border-blue-500 dark:border-blue-400 text-center mx-4 shadow-lg">
                                    <Upload className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 text-blue-600 dark:text-blue-400" />
                                    <p className="text-xl sm:text-2xl font-medium text-gray-900 dark:text-white">Drop files here</p>
                                    <p className="text-gray-600 dark:text-gray-300 mt-2 text-sm sm:text-base">to upload to CloudDrive</p>
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
                                className="mb-4 sm:mb-6"
                            >
                                <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 text-gray-900 dark:text-white">Uploading</h2>
                                <div className="space-y-2 sm:space-y-3">
                                    {uploadProgress.map((upload, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ scale: 0.9, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="bg-white dark:bg-gray-800 p-3 sm:p-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
                                        >
                                            <div className="flex items-center justify-between mb-2 gap-2">
                                                <span className="font-medium text-gray-900 dark:text-white flex items-center gap-2 min-w-0 flex-1">
                                                    <File className="w-4 h-4 flex-shrink-0" />
                                                    <span className="truncate text-sm sm:text-base">{upload.fileName}</span>
                                                </span>
                                                {upload.status === 'completed' && (
                                                    <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                                                )}
                                                {upload.status === 'error' && (
                                                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                                                )}
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${upload.progress}%` }}
                                                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
                                                />
                                            </div>
                                            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
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
                            className="flex flex-col items-center justify-center min-h-[60vh] px-4"
                        >
                            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                                <Cloud className="w-10 h-10 sm:w-12 sm:h-12 text-gray-400" />
                            </div>
                            <h3 className="text-xl sm:text-2xl font-normal text-gray-900 dark:text-white mb-2 text-center">No files yet</h3>
                            <p className="text-gray-500 dark:text-gray-400 mb-8 text-center text-sm sm:text-base">Get started by uploading your first file</p>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-6 sm:px-8 py-2.5 rounded-lg font-medium transition-colors shadow-sm text-sm sm:text-base"
                            >
                                Upload Files
                            </button>
                        </motion.div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-4 sm:mb-6">
                                <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                                    My Files <span className="text-gray-500 dark:text-gray-400">({filteredFiles.length})</span>
                                </h2>
                            </div>

                            {viewMode === 'grid' ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                                    {filteredFiles.map((file, i) => {
                                        const Icon = getFileIcon(file.mime_type);
                                        return (
                                            <motion.div
                                                key={file.id}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: i * 0.05 }}
                                                whileHover={{ y: -2 }}
                                                whileTap={{ scale: 0.98 }}
                                                className="bg-white dark:bg-gray-800 p-4 sm:p-5 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:shadow-md transition-all group"
                                                onClick={() => downloadFile(file.id, file.name)}
                                            >
                                                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-blue-50 rounded-lg flex items-center justify-center mb-3 sm:mb-4">
                                                    <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600" />
                                                </div>
                                                <h3 className="font-medium text-gray-900 dark:text-white mb-1 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-sm sm:text-base">
                                                    {file.name}
                                                </h3>
                                                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                                                    {formatFileSize(file.size)}
                                                </p>
                                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                                    {formatDate(file.created_at)}
                                                </p>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <>
                                    {/* Desktop Table View */}
                                    <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                                        <div className="overflow-x-auto">
                                            <table className="w-full">
                                                <thead className="bg-gray-50/50 dark:bg-gray-700/50">
                                                    <tr className="text-left text-sm text-gray-600 dark:text-gray-300">
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
                                                                className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors"
                                                            >
                                                                <td className="px-6 py-4">
                                                                    <div className="flex items-center gap-3">
                                                                    <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center flex-shrink-0">
                                                                        <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                                                    </div>
                                                                        <span className="font-medium text-gray-900 dark:text-white truncate">{file.name}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-4 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatFileSize(file.size)}</td>
                                                                <td className="px-6 py-4 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatDate(file.created_at)}</td>
                                                                <td className="px-6 py-4">
                                                                    <button
                                                                        onClick={() => downloadFile(file.id, file.name)}
                                                                        className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400 hover:scale-110 transform transition-all"
                                                                        aria-label="Download file"
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
                                    </div>

                                    {/* Mobile Card View (for list mode on mobile) */}
                                    <div className="lg:hidden space-y-2">
                                        {filteredFiles.map((file, i) => {
                                            const Icon = getFileIcon(file.mime_type);
                                            return (
                                                <motion.div
                                                    key={file.id}
                                                    initial={{ opacity: 0, y: 20 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: i * 0.03 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:shadow-md transition-all"
                                                    onClick={() => downloadFile(file.id, file.name)}
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center flex-shrink-0">
                                                            <Icon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <h3 className="font-semibold text-gray-900 dark:text-white mb-1 truncate text-sm sm:text-base">
                                                                {file.name}
                                                            </h3>
                                                            <div className="flex items-center gap-3 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                                                                <span>{formatFileSize(file.size)}</span>
                                                                <span>•</span>
                                                                <span>{formatDate(file.created_at)}</span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                downloadFile(file.id, file.name);
                                                            }}
                                                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300 flex-shrink-0 transition-colors"
                                                            aria-label="Download file"
                                                        >
                                                            <Download className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
