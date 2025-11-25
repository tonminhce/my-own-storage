'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, HardDrive } from 'lucide-react';
import Link from 'next/link';

export default function ProfilePage() {
    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4">
                <div className="flex items-center gap-4">
                    <Link href="/" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </Link>
                    <h1 className="text-2xl font-normal text-gray-900">Profile</h1>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Storage Stats */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-lg border border-gray-200 p-6"
                >
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                            <HardDrive className="w-5 h-5 text-blue-600" />
                        </div>
                        <h2 className="text-xl font-medium text-gray-900">Storage</h2>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-gray-700">Used</span>
                                <span className="text-sm text-gray-500">45.2 GB of 100 GB</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div className="bg-blue-600 h-2 rounded-full" style={{ width: '45.2%' }}></div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                            <div>
                                <p className="text-2xl font-medium text-gray-900">45.2 GB</p>
                                <p className="text-sm text-gray-500">Used</p>
                            </div>
                            <div>
                                <p className="text-2xl font-medium text-gray-900">54.8 GB</p>
                                <p className="text-sm text-gray-500">Available</p>
                            </div>
                            <div>
                                <p className="text-2xl font-medium text-gray-900">1,234</p>
                                <p className="text-sm text-gray-500">Files</p>
                            </div>
                            <div>
                                <p className="text-2xl font-medium text-gray-900">12</p>
                                <p className="text-sm text-gray-500">Folders</p>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </main>
        </div>
    );
}
