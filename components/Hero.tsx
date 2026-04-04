"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export default function Hero() {
  return (
    <section className="relative w-full min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-100 overflow-hidden">
      {/* Background Glow */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[500px] h-[500px] bg-yellow-300/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-5xl px-6 text-center">
        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-4xl md:text-6xl font-bold text-gray-900 leading-tight"
        >
          Build Smarter Solar Projects in Algeria
        </motion.h1>

        {/* Subtext */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-6 text-lg md:text-xl text-gray-600"
        >
          Perform accurate technical and economic feasibility studies tailored
          to the Algerian market. Empower your decisions with data-driven
          insights.
        </motion.p>

        {/* Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-8 flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Link
            href={"#study"}
            className="px-6 py-3 text-lg rounded-2xl bg-gray-900 text-white hover:bg-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl"
          >
            Start a Study
          </Link>
        </motion.div>

        {/* Stats / Trust indicators */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-gray-700"
        >
          <div>
            <p className="text-2xl font-semibold">+500</p>
            <p className="text-sm">Projects Simulated</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">98%</p>
            <p className="text-sm">Accuracy Rate</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">Local</p>
            <p className="text-sm">Market Data Integration</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
