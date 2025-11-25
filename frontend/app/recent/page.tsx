'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, Download, File, FileText, FileVideo, FileAudio, FileImage } from 'lucide-react';
import axios from 'axios';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://tonminhce.site';

interface FileMetadata {
    id: string;
    name: string;
    size: number;
    mime_type: string;
    status: string;
    created_at: string;
    chunks: any[];
}

export default function RecentPage() {
    const [files, setFiles] = useState<FileMetadata[]>([]);

    const fetchFiles = useCallback(async () => {
        try {
            const response = await axios.get(`${API_URL}/files`);
            const allFiles = response.data || [];
            // Sort by created_at (most recent first)
            const sorted = allFiles.sort((a: FileMetadata, b: FileMetadata) => 
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            setFiles(sorted);
        } catch (error) {
            console.error('Error fetching files:', error);
        }
    }, []);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

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
        const date = new Date(dateString);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4">
                <div className="flex items-center gap-4">
                    <Link href="/" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </Link>
                    <div className="flex items-center gap-3">
                        <Clock className="w-6 h-6 text-gray-600" />
                        <h1 className="text-2xl font-normal text-gray-900">Recent</h1>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[60vh]">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                            <Clock className="w-10 h-10 text-gray-400" />
                        </div>
                        <h3 className="text-xl font-normal text-gray-900 mb-2">No recent files</h3>
                        <p className="text-gray-500 text-sm">Files you've accessed recently will appear here</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr className="text-left text-sm text-gray-600">
                                    <th className="px-6 py-4 font-medium">Name</th>
                                    <th className="px-6 py-4 font-medium">Size</th>
                                    <th className="px-6 py-4 font-medium">Last accessed</th>
                                    <th className="px-6 py-4 font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {files.map((file, i) => {
                                    const Icon = getFileIcon(file.mime_type);
                                    return (
                                        <motion.tr
                                            key={file.id}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.03 }}
                                            className="border-t border-gray-100 hover:bg-gray-50 transition-colors"
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                                        <Icon className="w-5 h-5 text-blue-600" />
                                                    </div>
                                                    <span className="font-medium text-gray-900 truncate">{file.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-gray-600 whitespace-nowrap">{formatFileSize(file.size)}</td>
                                            <td className="px-6 py-4 text-gray-600 whitespace-nowrap">{formatDate(file.created_at)}</td>
                                            <td className="px-6 py-4">
                                                <button
                                                    onClick={() => downloadFile(file.id, file.name)}
                                                    className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
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
                )}
            </main>
        </div>
    );
}

