'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Trash2, Download, File, FileText, FileVideo, FileAudio, FileImage, RotateCcw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function TrashPage() {
    // This would typically come from your backend/state management
    const [trashedFiles] = useState<any[]>([]);

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
                        <Trash2 className="w-6 h-6 text-gray-600" />
                        <h1 className="text-2xl font-normal text-gray-900">Trash</h1>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {trashedFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[60vh]">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                            <Trash2 className="w-10 h-10 text-gray-400" />
                        </div>
                        <h3 className="text-xl font-normal text-gray-900 mb-2">Trash is empty</h3>
                        <p className="text-gray-500 text-sm">Files you delete will be moved to trash</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr className="text-left text-sm text-gray-600">
                                    <th className="px-6 py-4 font-medium">Name</th>
                                    <th className="px-6 py-4 font-medium">Deleted</th>
                                    <th className="px-6 py-4 font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trashedFiles.map((file, i) => {
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
                                                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                                        <Icon className="w-5 h-5 text-gray-500" />
                                                    </div>
                                                    <span className="font-medium text-gray-500 truncate">{file.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-gray-500">{file.deleted_at}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
                                                        aria-label="Restore file"
                                                    >
                                                        <RotateCcw className="w-5 h-5" />
                                                    </button>
                                                    <button
                                                        className="p-2 hover:bg-red-50 rounded-full text-red-600 transition-colors"
                                                        aria-label="Permanently delete"
                                                    >
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </div>
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

