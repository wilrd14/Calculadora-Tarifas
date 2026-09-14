export interface FreelancerProfile {
  name: string;
  email: string;
  phone: string;
  portfolio: string;
}

/**
 * Datos del freelancer que aparecen en el PDF. Están fijos aquí hasta que
 * exista la pantalla de Configuración (Fase 4) — edítalos a mano mientras
 * tanto, o reemplaza este archivo cuando se construya esa fase.
 */
export const freelancerProfile: FreelancerProfile = {
  name: "Profesional de ejemplo",
  email: "contacto@example.invalid",
  phone: "809-000-0000",
  portfolio: "portafolio.example.invalid",
};
