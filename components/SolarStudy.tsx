"use client";

import { motion } from "framer-motion";
import { useState } from "react";

export default function SolarStudyForm() {
  const [form, setForm] = useState({
    clientName: "",
    contractNumber: "",
    tariff: "",
    period: "",
    activeCadran1: "",
    activeCadran2: "",
    activeCadran3: "",
    reactiveConsumption: "",
    peakEnergy: "",
    offPeakEnergy: "",
    powerFactor: "",
    maxPower: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  return (
    <section
      id="study"
      className="min-h-screen bg-gradient-to-b from-white to-gray-100 flex items-center justify-center px-6 py-16"
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="w-full max-w-4xl bg-white rounded-3xl shadow-xl p-8"
      >
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center">
          Solar Project Study
        </h2>
        <p className="text-center text-gray-600 mt-2">
          Enter your electricity bill data to generate a feasibility study
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {Object.keys(form).map((key, index) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex flex-col"
            >
              <label className="text-sm text-gray-500 mb-1 capitalize">
                {key.replace(/([A-Z])/g, " $1")}
              </label>
              <input
                type="text"
                name={key}
                value={(form as any)[key]}
                onChange={handleChange}
                className="px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                placeholder={`Enter ${key}`}
              />
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-10 flex justify-center"
        >
          <button className="px-8 py-4 rounded-2xl bg-gray-900 text-white text-lg shadow-lg hover:shadow-xl hover:bg-gray-800 transition-all duration-300">
            Generate Study
          </button>
        </motion.div>
      </motion.div>
    </section>
  );
}
