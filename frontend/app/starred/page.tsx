'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Star, Download, File, FileText, FileVideo, FileAudio, FileImage } from 'lucide-react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function StarredPage() {
    // This would typically come from your backend/state management
    const [starredFiles] = useState<any[]>([]);

    const getFileIcon = (mimeType: string) => {
        if (mimeType.startsWith('image/')) return FileImage;
        if (mimeType.startsWith('video/')) return FileVideo;
        if (mimeType.startsWith('audio/')) return FileAudio;
        if (mimeType.includes('text') || mimeType.includes('document')) return FileText;
        return File;
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4">
                <div className="flex items-center gap-4">
                    <Link href="/" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </Link>
                    <div className="flex items-center gap-3">
                        <Star className="w-6 h-6 text-yellow-500 fill-yellow-500" />
                        <h1 className="text-2xl font-normal text-gray-900">Starred</h1>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {starredFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[60vh]">
                        <div className="w-20 h-20 bg-yellow-50 rounded-full flex items-center justify-center mb-6">
                            <Star className="w-10 h-10 text-yellow-400" />
                        </div>
                        <h3 className="text-xl font-normal text-gray-900 mb-2">No starred files</h3>
                        <p className="text-gray-500 text-sm">Star files to access them quickly from here</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {starredFiles.map((file, i) => {
                            const Icon = getFileIcon(file.mime_type);
                            return (
                                <motion.div
                                    key={file.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="bg-white p-5 rounded-lg border border-gray-200 hover:shadow-md transition-all"
                                >
                                    <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
                                        <Icon className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <h3 className="font-medium text-gray-900 mb-1 truncate text-sm">{file.name}</h3>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
}

